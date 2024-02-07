const express = require('express');
const http = require('http');
const socketIo = require('socket.io');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const LocalStrategy = require('passport-local').Strategy;
const JwtStrategy = require('passport-jwt').Strategy;
const ExtractJwt = require('passport-jwt').ExtractJwt;
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const GitHubStrategy = require('passport-github2').Strategy;
const mockingModule = require('./mockingModule');
const customizeError = require('./errorHandler');
const winston = require('winston');

const userSchema = new mongoose.Schema({
  first_name: String,
  last_name: String,
  email: { type: String, unique: true },
  age: Number,
  password: String,
  cart: { type: mongoose.Schema.Types.ObjectId, ref: 'Cart' },
  role: { type: String, default: 'user' },
});

const User = mongoose.model('User', userSchema);

passport.use(new LocalStrategy(
  async (email, password, done) => {
    try {
      const user = await User.findOne({ email });

      if (!user || !(await bcrypt.compare(password, user.password))) {
        return done(null, false, { message: 'Usuario o contraseña incorrectos' });
      }

      return done(null, user);
    } catch (error) {
      return done(error);
    }
  }
));

const jwtOptions = {
  jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
  secretOrKey: 'tu_secreto',
};

passport.use(new JwtStrategy(jwtOptions, async (payload, done) => {
  try {
    const user = await User.findById(payload.id);

    if (user) {
      return done(null, user);
    } else {
      return done(null, false);
    }
  } catch (error) {
    return done(error, false);
  }
}));

passport.use(new GitHubStrategy({
  clientID: 'tuClientID',
  clientSecret: 'tuClientSecret',
  callbackURL: 'http://tu-app-url/auth/github/callback'
},
async (accessToken, refreshToken, profile, done) => {
  try {
    let user = await User.findOne({ email: profile.emails[0].value });

    if (!user) {
      user = new User({
        email: profile.emails[0].value,
        first_name: profile.displayName || profile.username,
      });
      await user.save();
    }

    return done(null, user);
  } catch (error) {
    return done(error, false);
  }
}));

const app = express();
const server = http.createServer(app);
const io = socketIo(server);

app.use(cors());
app.use(express.json());
app.use(session({
  secret: 'tu_secreto',
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: true,
    httpOnly: true,
    maxAge: 24 * 60 * 60 * 1000,
  },
}));
app.use(passport.initialize());
app.use(passport.session());

app.use('/', mockingModule);

app.post('/login', (req, res, next) => {
  passport.authenticate('local', { session: false }, (err, user) => {
    if (err || !user) {
      return res.status(401).json({ message: 'Autenticación fallida' });
    }

    const token = jwt.sign({ id: user._id }, 'tu_secreto', { expiresIn: '1h' });

    return res.json({ token });
  })(req, res, next);
});

app.get('/api/sessions/current', passport.authenticate('jwt', { session: false }), (req, res) => {
  const userDto = {
    id: req.user._id,
    first_name: req.user.first_name,
    last_name: req.user.last_name,
    email: req.user.email,
    role: req.user.role,
  };

  res.json(userDto);
});

const repository = require('./repository');

const authorizeMiddleware = (req, res, next) => {
  const isAdmin = req.user && req.user.role === 'admin';

  if (isAdmin) {
    next();
  } else {
    res.status(403).json({ error: 'Acceso no autorizado' });
  }
};

const processPurchase = async (cart) => {
  return { success: true, failedProducts: [] };
};

const createTicket = async (cart, purchaserEmail) => {
  try {
    const productsInCart = await repository.getProductsInCart(cart._id);

    const ticket = {
      purchaserEmail,
      products: productsInCart,
      totalAmount: calculateTotalAmount(productsInCart),
      date: new Date(),
    };

    return ticket;
  } catch (error) {
    throw error;
  }
};

const calculateTotalAmount = (products) => {
  return products.reduce((total, product) => total + product.price, 0);
};

app.post('/api/carts/:cid/purchase', authorizeMiddleware, async (req, res) => {
  try {
    const cartId = req.params.cid;
    const cart = await repository.getCartById(cartId);

    const purchaseResult = await processPurchase(cart);

    if (purchaseResult.success) {
      const ticket = await createTicket(cart, req.user.email);
      await repository.clearCart(cartId);
      res.json({ message: 'Compra realizada con éxito', ticket });
    } else {
      res.json({ message: 'Algunos productos no pudieron ser comprados', failedProducts: purchaseResult.failedProducts });
    }
  } catch (error) {
    const customError = customizeError('unknownError');
    res.status(500).json({ error: customError });
  }
});

const port = 8080;

const developmentLogger = winston.createLogger({
  level: 'debug',
  transports: [
    new winston.transports.Console()
  ]
});

const productionLogger = winston.createLogger({
  level: 'info',
  transports: [
    new winston.transports.File({ filename: 'errors.log', level: 'error' })
  ]
});

const loggerMiddleware = (req, res, next) => {
  req.logger = developmentLogger;
  res.logger = developmentLogger;
  next();
};

console.log = developmentLogger.info;
console.error = developmentLogger.error;

app.get('/loggerTest', (req, res) => {
  req.logger.debug('Debug log');
  req.logger.http('HTTP log');
  req.logger.info('Info log');
  req.logger.warn('Warning log');
  req.logger.error('Error log');
  req.logger.fatal('Fatal log');

  res.send('Logs registrados en consola y archivo (si corresponde)');
});

app.use(loggerMiddleware);

app.use((err, req, res, next) => {
  productionLogger.error(err.stack);
  res.status(500).send('Something broke!');
});

server.listen(port, () => {
  console.log(`Server is running on port ${port}`);
});
