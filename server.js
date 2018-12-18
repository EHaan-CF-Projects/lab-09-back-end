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

//Server Listener
app.listen(PORT, () => console.log(`Listening on port ${PORT}`));

// Error handler
function handleError (err, res) {
  console.error(err);
  if (res) res.status(500).send('Something went wrong');
}

//===============LOCATION==============================
app.get('/location', (req, res) => {
  let query = req.query.data;
  
  //check our db for stored data
  const SQL = 'SELECT * FROM locations WHERE search_query=$1';
  const values = [query];
  return client.query(SQL, values)

  //if we have it, send it back;
    .then(data => {
      if(data.rowCount){
        console.log('Location retrieved from database')
        res.status(200).send(data.rows[0]);
      } else {
  // if not, get it from API
        const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GOOGLE_MAPS_API}`
        return superagent.get(URL)
          .then(result => {
            console.log('location retrieved from API')
  
  // normalize it
            let location = new Location(result.body.results[0]);
            let SQL = `INSERT INTO locations
                      (search_query, formatted_query, latitude, longitude)
                      VALUES($1, $2, $3, $4) RETURNING *`;

  // store it in database
            return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude])
  
  // then send it back 
            .then( (result) => {
              console.log(result.rows[0])
               res.status(200).send(result.rows[0]);
             })
          })
      }
    })
    .catch(err => {
      console.error(err);
      res.send(err)
    })
})

//===============WEATHER==============================
app.get('/weather', (req, res) => {
  //check out db for stored data
  let SQL = 'SELECT * FROM weathers WHERE location_id=$1';
  let values = [req.query.data.id];
  client.query(SQL, values)

  //if we have it, send it back
    .then(data => {
      if(data.rowCount) {
        console.log('Weather retrieved from database')
        res.status(200).send(data.rows);
      } else {

  //if not, get it from API
        const URL = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API}/${req.query.data.latitude},${req.query.data.longitude}`;
        return superagent.get(URL)
          .then(result => {
            console.log('Weather retrieved from API')
  
  // normalize it
            let weeklyForecast = result.body.daily.data.map(dailyForecast => {
              let weather = new Forecast(dailyForecast);
              SQL = `INSERT INTO weathers
                    (time, forecast, location_id)
                    VALUES($1, $2, $3)`;
  
// store it in database
              values = [weather.time, weather.forecast, req.query.data.id];
              client.query(SQL, values);
              return(weather);
            })
// then send it back
            res.status(200).send(weeklyForecast);
          })
        .catch(err => {
          console.error(err);
          res.send(err)
        })
      }
    })
  .catch(err => {
    console.error(err);
    res.send(err)
  })
})

//===============YELP==============================
app.get('/yelp', (req, res) => {
  //check out db for stored data
  let SQL = 'SELECT * FROM weathers WHERE location_id=$1';
  let values = [req.query.data.id];
  client.query(SQL, values)

  // if we have it, send it back
    .then(data => {
      if(data.rowCount) {
        console.log('Yelp retrieved from database')
        res.status(200).send(data.rows);
      } else {

  // if not, get it from API
        const URL = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${req.query.data.latitude}&longitude=${req.query.data.longitude}`;
        return superagent.get(URL)
          .set('Authorization', `Bearer ${process.env.YELP_API}`)
          .then(result => {
            console.log('Yelp retrieved from API')
          
  // normalize it
            let yelpReviews = result.body.businesses.map(business => {
              let review = new Yelp(business);
              SQL = `INSERT INTO yelps
                    (name, image_url, price, rating, url, location_id)
                    VALUES($1, $2, $3, $4, $5, $6)`;
    
  // store it in database
              values = [review.name, review.image_url, review.price, review.rating, review.url, req.query.data.id];
              client.query(SQL, values);
              return(review);
            })
  
  // then send it back
            res.status(200).send(yelpReviews);
          })
        .catch(err => {
          console.error(err);
          res.send(err)
        })
      }
    })
  .catch(err => {
    console.error(err);
    res.send(err)
  })
})

//===============TMDB==============================


// Constructors

function Location(location){
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
}

function Forecast(dailyForecast){
  this.time = new Date(dailyForecast.time * 1000).toDateString();
  this.forecast = dailyForecast.summary;
}

function Yelp(business){
  this.name = business.name;
  this.image_url = business.image_url;
  this.price = business.price;
  this.rating = business.rating;
  this.url = business.url;
}
