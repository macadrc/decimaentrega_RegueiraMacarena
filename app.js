const express = require('express');
const http = require('http');
const mongoose = require('mongoose');
const cors = require('cors');
const session = require('express-session');
const passport = require('passport');
const config = require('./config');
const routes = require('./routes');
const winston = require('winston');

const app = express();
const server = http.createServer(app);

mongoose.connect(config.mongoURI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
});

const db = mongoose.connection;
db.on('error', console.error.bind(console, 'Error de conexión a MongoDB:'));
db.once('open', () => {
  console.log('Conexión exitosa a MongoDB');
});

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

app.use(session({
  secret: config.jwtSecret,
  resave: false,
  saveUninitialized: true,
}));
app.use(passport.initialize());
app.use(passport.session());
app.use(cors());
app.use(express.json());
app.use(loggerMiddleware);
app.use('/api', routes);

app.use((err, req, res, next) => {
  productionLogger.error(err.stack);
  res.status(500).send('Something broke!');
});

const port = 8080;
server.listen(port, () => {
  console.log(`Servidor escuchando en el puerto ${port}`);
});
