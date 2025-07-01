const express = require('express');
const bodyParser = require('body-parser');
const cors = require('cors');
require('dotenv').config();

console.log('✅ Loaded PORT:', process.env.PORT);

const agenticRoutes = require('./agentic');
const golfgptRoutes = require('./golfgpt');
//const gamePlayRoutes = require('./gameplay');
//const gamePlayRoutes = require('./gameplayv2');
const gamePlayRoutes = require('./gameplayv3');
const socialRoutes = require('./social')

const app = express();

const corsOptions = {
  origin: '*',
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: true
};

app.use(cors(corsOptions));
app.options(/^\/.*$/, cors(corsOptions));
app.use(bodyParser.json());

app.use('/', agenticRoutes);
app.use('/gpt', golfgptRoutes);
app.use('/game', gamePlayRoutes);
app.use('/social', socialRoutes);

const PORT = process.env.PORT;
app.listen(PORT, () => console.log(`Server running on port ${PORT}`));

