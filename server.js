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
// app.get('/weather', getWeather);
// app.get('yelp', getYelp);
// app.get('/movies', getMovies);

//Server Listener
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

// Error handler
function handleError (err, res) {
  console.error(err);
  if (res) res.status(500).send('Something went wrong');
}

// Module Handlers
function getLocation(req, res){
  let lookupHandler = {
    cacheHit : (data) => {
      console.log('Location retrieved from database')
      res.status(200).send(data.rows[0]);
  },
  cacheMiss : (query) => {
      return searchForLocation(query)
      .then(result => {
          res.send(result);
      })
    }
  }
  lookupLocation(req.query.data, lookupHandler);
}

// Database Lookup
function lookupLocation(query, handler){
  const SQL = 'SELECT * FROM locations WHERE search_query=$1'
  const values = [query];
  return client.query(SQL, values)
    .then(data => {
      if (data.rowCount){
        handler.cacheHit(data);
      } else {
        handler.cacheMiss(query);
      }
  })
}

// Constructors
function Location(location){
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
  this.short_name = location.address_components[0].short_name;
}

// Search for Resource
function searchForLocation(query){
  const mapURL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GOOGLE_MAPS_API}`;
  return superagent.get(mapURL)
    .then(geoData => {
      console.log('Location retrieved from API')
      let location = new Location(geoData.body.results[0]);
      let SQL = `INSERT INTO locations
                (search_query, formatted_query, latitude, longitude)
                VALUES($1, $2, $3, $4)`;
      
      return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude])
        .then( () => {
          return location;
        })
    })
    .catch(err => console.error(err));
}

