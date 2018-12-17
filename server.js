'use strict'

//Application Dependencies
const express = require('express');
const superagent = require('superagent');
const pg = require('pg');
const cors = require('cors');

//Environment Variobles
require('dotenv').config();

//Application Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

//Database Setup
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

//API Routes
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('yelp', getYelp);
app.get('/movies', getMovies);

//Server Listener
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

//Error handler
function handleError (err, res) {
    console.error(err);
    if (res) res.status(500).send('Something went wrong');
}

