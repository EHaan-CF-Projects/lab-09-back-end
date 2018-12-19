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
// app.get('/location', getLocation);

// function getLocation(req, res) {
//   let lookupHandler = {
//     cacheHit : (data) => {
//   console.log('Location retrieved from database')
//   res.status(200).send(data.rows[0]);
//     },
//     cacheMiss : (query) => {
//       return fetchLocation(query)
//         .then(result => {
//           res.send(result)
//         })
//     }
//   }
//   lookupLocation(req.query.data, lookupHandler);
// }

// function lookupLocation(query, handler) {
//   //check our db for stored data
//   const SQL = 'SELECT * FROM locations WHERE search_query=$1';
//   const values = [query];
//   return client.query(SQL, values)
//   .then(data => {
//   //if we have it, send it back; if not, get it from API
//     if(data.rowCount){
//       handler.cacheHit(data);
//     } else {
//       handler.cacheMiss(query);
//     }
//   })
// }

// function fetchLocation(query) {
//   const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GOOGLE_MAPS_API}`
//   return superagent.get(URL)
//     .then(result => {
//       console.log('location retrieved from API')

// // normalize it & store it in database
//       let location = new Location(result.body.results[0]);
//       let SQL = `INSERT INTO locations
//                 (search_query, formatted_query, latitude, longitude, short_name)
//                 VALUES($1, $2, $3, $4, $5) RETURNING *`;
//       return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude, location.short_name])

// // then send it back 
//       .then( (result) => {
//         return result.rows[0];
//       })
//     })
// }

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
                      (search_query, formatted_query, latitude, longitude, short_name)
                      VALUES($1, $2, $3, $4, $5) RETURNING *`;

  // store it in database
            return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude, location.short_name])
  
  // then send it back 
            .then( (result) => {
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
  let SQL = 'SELECT * FROM yelps WHERE location_id=$1';
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
app.get('/movies', (req, res) => {
  //check out db for stored data
  let SQL = 'SELECT * FROM movies WHERE location_id=$1';
  let values = [req.query.data.id];
  client.query(SQL, values)

  // if we have it, send it back
    .then(data => {
      if(data.rowCount) {
        console.log('Movies retrieved from database')
        res.status(200).send(data.rows);
      } else {
      
  // if not, get it from API
        const URL = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_DB_API}&query=${req.query.data.short_name}`;
        return superagent.get(URL)
          .then (result => {
            console.log('Movies retrieved from API')

  // normalize it
            let movieSuggestions = result.body.results.map(newMovie => {
              let localMovie = new Movie(newMovie);
              SQL = `INSERT INTO movies
                    (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id)
                    VALUES($1, $2, $3, $4, $5, $6, $7, $8)`;

  // store it in datbase
              values = [localMovie.title, localMovie.overview, localMovie.average_votes, localMovie.total_votes, localMovie.image_url, localMovie.popularity, localMovie.released_on, req.query.data.id];
              client.query(SQL, values);
              return(localMovie);
            })

  // then send it back
            res.status(200).send(movieSuggestions);
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

//===============Meetups==============================
app.get('/meetups', (req, res) => {
  //check out db for stored data
  let SQL = 'SELECT * FROM meetups WHERE location_id=$1';
  let values = [req.query.data.id];
  client.query(SQL, values)

  // if we have it, send it back
    .then(data => {
      if (data.rowCount) {
      console.log('Meetups retrieved from database')
      res.status(200).send(data.rows);
      } else {

  //if not, get it from API
        const URL = `https://api.meetup.com/find/upcoming_events?sign=true&photo-host=public&lon=${req.query.data.longitude}&page=20&lat=${req.query.data.latitude}&key=${process.env.MEETUPS_API_KEY}`;
        return superagent.get(URL)
          .then (result => {
            console.log('Meetups retrieved from API')

  // normalize it
            let meetupSuggestions = result.body.events.map(upcomingMeetup => {
              let localMeetups = new Meetup(upcomingMeetup);
              SQL = `INSERT INTO meetups
                    (link, name, creation_date, host, location_id)
                    VALUES($1, $2, $3, $4, $5)`;

  // store it in database
              values = [localMeetups.link, localMeetups.name, localMeetups.creation_date, localMeetups.host, req.query.data.id]
              client.query(SQL, values);
              return(localMeetups);
            })
  // then send it back
            res.status(200).send(meetupSuggestions);
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

//===============Trails==============================
app.get('/trails', (req, res) => {
  let SQL = 'SELECT * FROM trails WHERE location_id=$1';
  let values = [req.query.data.id];
  client.query(SQL, values)

  //if we have it, send it back
    .then(data => {
      if (data.rowCount) {
        console.log('Trails retrieved from database')
        res.status(200).send(data.rows);
      } else {
        
  // if not, get it from API
        const URL = `https://www.hikingproject.com/data/get-trails?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&key=${process.env.HIKING_PROJECT_API_KEY}`;
        return superagent.get(URL)
          .then(result => {
            console.log('Trails retrieved from API')

  // normalize it
            let hikeSuggestions = result.body.trails.map(nearbyTrail => {
              let localTrails = new Trail(nearbyTrail);
              SQL = `INSERT INTO trails
                    (name, location, length, stars, star_votes, summary, trail_url, condition_details, condition_date, condition_time, location_id)
                    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

  // store it in database
  values = [localTrails.name, localTrails.location, localTrails.length, localTrails.stars, localTrails.star_votes, localTrails.summary, localTrails.trail_url, localTrails.condition_details, localTrails.condition_date, localTrails.condition_time, req.query.data.id]
  console.log(localTrails.conditionDetails);
              client.query(SQL, values);
              return(localTrails);
            })
          
  // then send it back
            res.status(200).send(hikeSuggestions);
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



// Constructors

function Trail(nearbyTrail) {
  this.name = nearbyTrail.name;
  this.location = nearbyTrail.location;
  this.length = nearbyTrail.length;
  this.stars = nearbyTrail.stars;
  this.star_votes = nearbyTrail.starVotes;
  this.summary = nearbyTrail.summary;
  this.trail_url = nearbyTrail.trail_url;
  this.condition_details = nearbyTrail.conditionDetails;
  this.condition_date = nearbyTrail.conditionDate.slice(0,9);
  this.condition_time = nearbyTrail.conditionDate.slice(11,18);
}

function Location(location){
  this.formatted_query = location.formatted_address;
  this.latitude = location.geometry.location.lat;
  this.longitude = location.geometry.location.lng;
  this.short_name = location.address_components[0].short_name;
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

function Movie(newMovie){
  this.title = newMovie.title;
  this.overview = newMovie.overview;
  this.average_votes = newMovie.vote_average;
  this.total_votes = newMovie.vote_count;
  this.image_url = 'https://image.tmdb.org/t/p/w200_and_h300_bestv2/' + newMovie.poster_path;
  this.popularity = newMovie.popularity;
  this.released_on = newMovie.release_date;
}

function Meetup(upcomingMeetup) {
  this.link = upcomingMeetup.link;
  this.name = upcomingMeetup.name;
  this.creation_date = new Date(upcomingMeetup.group.created).toDateString();
  this.host = upcomingMeetup.group.name;
}