'use strict';

// Application Dependencies
const express = require('express');
const superagent = require('superagent');
const pg = require('pg');
const cors = require('cors');

// Load environment variables from .env file
require('dotenv').config();

// Application Setup
const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());

// Database Setup
const client = new pg.Client(process.env.DATABASE_URL);
client.connect();
client.on('error', err => console.error(err));

// Make sure the server is listening for requests
app.listen(PORT, () => console.log(`Listening on ${PORT}`));

// Error handler
function handleError(err, res) {
  console.error(err);
  if (res) res.status(500).send('Sorry, something went wrong');
}

//===============================

// API Routes
app.get('/location', getLocation);
app.get('/weather', getWeather);
app.get('/yelp', getYelp);
app.get('/movies', getMovies);
app.get('/meetups', getMeetups);
app.get('/trails', getTrails);

//===============================

// Look for the results in the database
function lookup(options) {
  const SQL = `SELECT * FROM ${options.tableName} WHERE location_id=$1;`;
  const values = [options.location];

  client.query(SQL, values)
    .then(result => {
      if(result.rowCount > 0) {
        options.cacheHit(result);
      } else {
        options.cacheMiss();
      }
    })
    .catch(error => handleError(error));
}

// Models
//===============LOCATION==============================

function Location(query, res) {
  this.tableName = 'locations';
  this.search_query = query;
  this.formatted_query = res.body.results[0].formatted_address;
  this.latitude = res.body.results[0].geometry.location.lat;
  this.longitude = res.body.results[0].geometry.location.lng;
}

Location.lookupLocation = (location) => {
  const SQL = `SELECT * FROM locations WHERE search_query=$1;`;
  const values = [location.query];
  return client.query(SQL, values)
    .then(result => {
      if(result.rowCount > 0) {
        location.cacheHit(result);
      } else {
        location.cacheMiss();
      }
    })
    .catch(console.error);
}

Location.prototype = {
  save: function() {
    const SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude) VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id;`;
    const values = [this.search_query, this.formatted_query, this.latitude, this.longitude];
    return client.query(SQL, values)
      .then(result => {
        this.id = result.rows[0].id;
        return this;
      });
  }
};

function getLocation(request, response) {
  Location.lookupLocation({
    tableName: Location.tableName,
    query: request.query.data,
    cacheHit: function(result) {
      response.send(result.rows[0]);
    },
    cacheMiss: function() {
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GEOCODE_API_KEY}`;
      return superagent.get(url)
        .then(result => {
          const location = new Location(this.query, result);
          location.save()
            .then(location => response.send(location));
        })
        .catch(error => handleError(error));
    }
  })
}

//===============WEATHER==============================

function Weather(day) {
  this.tableName = 'weathers';
  this.forecast = day.summary;
  this.time = new Date(day.time * 1000).toDateString();
}

Weather.tableName = 'weathers';
Weather.lookup = lookup;

Weather.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (forecast, time, location_id) VALUES ($1, $2, $3);`;
    const values = [this.forecast, this.time, location_id];
    client.query(SQL, values);
  }
}

function getWeather(request, response) {
  const weatherHandler = {
    tableName: Weather.tableName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API}/${req.query.data.latitude},${req.query.data.longitude}`;
      superagent.get(url)
        .then(result => {
          const weatherSummaries = result.body.daily.data.map(day => {
            const summary = new Weather(day);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(weatherSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Weather.lookup(weatherHandler);
}

//===============YELP==============================

function Yelp(business){
  this.tableName = 'yelps'
  this.name = business.name;
  this.image_url = business.image_url;
  this.price = business.price;
  this.rating = business.rating;
  this.url = business.url;
}

Yelp.tableName = 'yelps';
Yelp.lookup = lookup;

Yelp.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (name, image_url, price, rating, url, location_id) VALUES($1, $2, $3, $4, $5, $6)`;
    const values = [this.name, this.image_url, this.price, this.rating, this.url, location_id];
    client.query(SQL, values);
  }
}

function getYelp(request, response) {
  const yelpHandler = {
    tableName: Yelp.tableName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function() {
      const URL = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${req.query.data.latitude}&longitude=${req.query.data.longitude}`;
      superagent.get(URL)
        .set('Authorization', `Bearer ${process.env.YELP_API}`)
        .then(result => {
          const yelpSummaries = result.body.businesses.map(review => {
            const summary = new Yelp(review);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(yelpSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Yelp.lookup(yelpHandler);
}

//===============TMDB==============================
function Movie(localMovie) {
  this.tableName = 'movies';
  this.title = localMovie.title;
  this.overview = localMovie.overview;
  this.average_votes = localMovie.vote_average;
  this.total_votes = localMovie.vote_count;
  this.image_url = 'https://image.tmdb.org/t/p/w200_and_h300_bestv2/' + localMovie.poster_path;
  this.popularity = localMovie.popularity;
  this.released_on = localMovie.release_date;
}

Movie.tableName = 'movies';
Movie.lookup = lookup;

Movie.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id) VALUES($1, $2, $3, $4, $5, $6, $7, $8)`;
    const values = [this.title, this.overview, this.average_votes, this.total_votes, this.image_url, this.popularity, this.released_on, req.query.data.id];
    client.query(SQL, values);
  }
}

function getMovies(request, response) {
  const movieHandler = {
    tableName: Movie.tableName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_DB_API}&query=${req.query.data.short_name}`;
      superagent.get(url)
        .then(result => {
          const movieSummaries = result.body.results.map(localMovie => {
            const summary = new Movie(localMovie);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(movieSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Movie.lookup(movieHandler);
}

//===============Meetups==============================
function Meetup(upcomingMeetup) {
  this.tableName = 'meetups'
  this.link = upcomingMeetup.link;
  this.name = upcomingMeetup.name;
  this.creation_date = new Date(upcomingMeetup.group.created).toDateString();
  this.host = upcomingMeetup.group.name;
}

Meetup.tablename = 'meetups';
Meetup.lookup = lookup;

Weather.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (link, name, creation_date, host, location_id) VALUES($1, $2, $3, $4, $5)`;
    const values = [this.link, this.name, this.creation_date, this.host, req.query.data.id];
    client.query(SQL, values);
  }
}

function getMeetups(request, response) {
  const meetupsHandler = {
    tableName: Meetup.tableName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://api.meetup.com/find/upcoming_events?sign=true&photo-host=public&lon=${req.query.data.longitude}&page=20&lat=${req.query.data.latitude}&key=${process.env.MEETUPS_API_KEY}`;
      superagent.get(url)
        .then(result => {
          const meetupSummaries = result.body.events.map(upcomingMeetup => {
            const summary = new Meetup(upcomingMeetup);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(meetupSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Meetup.lookup(meetupsHandler);
}

//===============Trails==============================

function Trail(nearbyTrail) {
  this.tableName = 'trails';
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

Trail.tableName = 'trails';
Trail.lookup = lookup;

Trail.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (name, location, length, stars, star_votes, summary, trail_url, condition_details, condition_date, condition_time, location_id)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
    const values = [this.name, this.location, this.length, this.stars, this.star_votes, this.summary, this.trail_url, this.condition_details, this.condition_date, this.condition_time, req.query.data.id];
    client.query(SQL, values);
  }
}

function getTrails(request, response) {
  const trailHandler = {
    tableName: Trail.talbeName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      const URL = `https://www.hikingproject.com/data/get-trails?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&key=${process.env.HIKING_PROJECT_API_KEY}`;
      superagent.get(url)
        .then(result => {
          const trailSummaries = result.body.trails.map(localTrail => {
            const summary = new Trail(localTrail);
            summary.save(request.query.data.id);
            return summary;
          });
          response.send(trailSummaries);
        })
        .catch(error => handleError(error, response));
    }
  };
  Trail.lookup(trailHandler);
}

//+++++++++++++==Unfactored/Semi-refacterd versions. Maintain for Reference==+++++++++++++++++++++


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

// app.get('/location', (req, res) => {
//   let query = req.query.data;
  
//   //check our db for stored data
//   const SQL = 'SELECT * FROM locations WHERE search_query=$1';
//   const values = [query];
//   return client.query(SQL, values)

//   //if we have it, send it back;
//     .then(data => {
//       if(data.rowCount){
//         console.log('Location retrieved from database')
//         res.status(200).send(data.rows[0]);
//       } else {
//   // if not, get it from API
//         const URL = `https://maps.googleapis.com/maps/api/geocode/json?address=${query}&key=${process.env.GOOGLE_MAPS_API}`
//         return superagent.get(URL)
//           .then(result => {
//             console.log('location retrieved from API')
  
//   // normalize it
//             let location = new Location(result.body.results[0]);
//             let SQL = `INSERT INTO locations
//                       (search_query, formatted_query, latitude, longitude, short_name)
//                       VALUES($1, $2, $3, $4, $5) RETURNING *`;

//   // store it in database
//             return client.query(SQL, [query, location.formatted_query, location.latitude, location.longitude, location.short_name])
  
//   // then send it back 
//             .then( (result) => {
//                res.status(200).send(result.rows[0]);
//              })
//           })
//       }
//     })
//     .catch(err => {
//       console.error(err);
//       res.send(err)
//     })
// })

// //===============WEATHER==============================
// app.get('/weather', (req, res) => {
//   //check out db for stored data
//   let SQL = 'SELECT * FROM weathers WHERE location_id=$1';
//   let values = [req.query.data.id];
//   client.query(SQL, values)

//   //if we have it, send it back
//     .then(data => {
//       if(data.rowCount) {
//         console.log('Weather retrieved from database')
//         res.status(200).send(data.rows);
//       } else {

//   //if not, get it from API
//         const URL = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API}/${req.query.data.latitude},${req.query.data.longitude}`;
//         return superagent.get(URL)
//           .then(result => {
//             console.log('Weather retrieved from API')
  
//   // normalize it
//             let weeklyForecast = result.body.daily.data.map(dailyForecast => {
//               let weather = new Forecast(dailyForecast);
//               SQL = `INSERT INTO weathers
//                     (time, forecast, location_id)
//                     VALUES($1, $2, $3)`;
  
// // store it in database
//               values = [weather.time, weather.forecast, req.query.data.id];
//               client.query(SQL, values);
//               return(weather);
//             })
// // then send it back
//             res.status(200).send(weeklyForecast);
//           })
//         .catch(err => {
//           console.error(err);
//           res.send(err)
//         })
//       }
//     })
//   .catch(err => {
//     console.error(err);
//     res.send(err)
//   })
// })

// //===============YELP==============================
// app.get('/yelp', (req, res) => {
//   //check out db for stored data
//   let SQL = 'SELECT * FROM yelps WHERE location_id=$1';
//   let values = [req.query.data.id];
//   client.query(SQL, values)

//   // if we have it, send it back
//     .then(data => {
//       if(data.rowCount) {
//         console.log('Yelp retrieved from database')
//         res.status(200).send(data.rows);
//       } else {

//   // if not, get it from API
//         const URL = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${req.query.data.latitude}&longitude=${req.query.data.longitude}`;
//         return superagent.get(URL)
//           .set('Authorization', `Bearer ${process.env.YELP_API}`)
//           .then(result => {
//             console.log('Yelp retrieved from API')
          
//   // normalize it
//             let yelpReviews = result.body.businesses.map(business => {
//               let review = new Yelp(business);
//               SQL = `INSERT INTO yelps
//                     (name, image_url, price, rating, url, location_id)
//                     VALUES($1, $2, $3, $4, $5, $6)`;
    
//   // store it in database
//               values = [review.name, review.image_url, review.price, review.rating, review.url, req.query.data.id];
//               client.query(SQL, values);
//               return(review);
//             })
  
//   // then send it back
//             res.status(200).send(yelpReviews);
//           })
//         .catch(err => {
//           console.error(err);
//           res.send(err)
//         })
//       }
//     })
//   .catch(err => {
//     console.error(err);
//     res.send(err)
//   })
// })

// //===============TMDB==============================
// app.get('/movies', (req, res) => {
//   //check out db for stored data
//   let SQL = 'SELECT * FROM movies WHERE location_id=$1';
//   let values = [req.query.data.id];
//   client.query(SQL, values)

//   // if we have it, send it back
//     .then(data => {
//       if(data.rowCount) {
//         console.log('Movies retrieved from database')
//         res.status(200).send(data.rows);
//       } else {
      
//   // if not, get it from API
//         const URL = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_DB_API}&query=${req.query.data.short_name}`;
//         return superagent.get(URL)
//           .then (result => {
//             console.log('Movies retrieved from API')

//   // normalize it
//             let movieSuggestions = result.body.results.map(newMovie => {
//               let localMovie = new Movie(newMovie);
//               SQL = `INSERT INTO movies
//                     (title, overview, average_votes, total_votes, image_url, popularity, released_on, location_id)
//                     VALUES($1, $2, $3, $4, $5, $6, $7, $8)`;

//   // store it in datbase
//               values = [localMovie.title, localMovie.overview, localMovie.average_votes, localMovie.total_votes, localMovie.image_url, localMovie.popularity, localMovie.released_on, req.query.data.id];
//               client.query(SQL, values);
//               return(localMovie);
//             })

//   // then send it back
//             res.status(200).send(movieSuggestions);
//           })
//         .catch(err => {
//           console.error(err);
//           res.send(err)
//         })
//       }
//     })
//   .catch(err => {
//     console.error(err);
//     res.send(err)
//   }) 
// })

// //===============Meetups==============================
// app.get('/meetups', (req, res) => {
//   //check out db for stored data
//   let SQL = 'SELECT * FROM meetups WHERE location_id=$1';
//   let values = [req.query.data.id];
//   client.query(SQL, values)

//   // if we have it, send it back
//     .then(data => {
//       if (data.rowCount) {
//       console.log('Meetups retrieved from database')
//       res.status(200).send(data.rows);
//       } else {

//   //if not, get it from API
//         const URL = `https://api.meetup.com/find/upcoming_events?sign=true&photo-host=public&lon=${req.query.data.longitude}&page=20&lat=${req.query.data.latitude}&key=${process.env.MEETUPS_API_KEY}`;
//         return superagent.get(URL)
//           .then (result => {
//             console.log('Meetups retrieved from API')

//   // normalize it
//             let meetupSuggestions = result.body.events.map(upcomingMeetup => {
//               let localMeetups = new Meetup(upcomingMeetup);
//               SQL = `INSERT INTO meetups
//                     (link, name, creation_date, host, location_id)
//                     VALUES($1, $2, $3, $4, $5)`;

//   // store it in database
//               values = [localMeetups.link, localMeetups.name, localMeetups.creation_date, localMeetups.host, req.query.data.id]
//               client.query(SQL, values);
//               return(localMeetups);
//             })
//   // then send it back
//             res.status(200).send(meetupSuggestions);
//           })
//         .catch(err => {
//           console.error(err);
//           res.send(err)
//         })
//       }
//     })
//   .catch(err => {
//     console.error(err);
//     res.send(err)
//   })
// })

// //===============Trails==============================
// app.get('/trails', (req, res) => {
//   let SQL = 'SELECT * FROM trails WHERE location_id=$1';
//   let values = [req.query.data.id];
//   client.query(SQL, values)

//   //if we have it, send it back
//     .then(data => {
//       if (data.rowCount) {
//         console.log('Trails retrieved from database')
//         res.status(200).send(data.rows);
//       } else {
        
//   // if not, get it from API
//         const URL = `https://www.hikingproject.com/data/get-trails?lat=${req.query.data.latitude}&lon=${req.query.data.longitude}&key=${process.env.HIKING_PROJECT_API_KEY}`;
//         return superagent.get(URL)
//           .then(result => {
//             console.log('Trails retrieved from API')

//   // normalize it
//             let hikeSuggestions = result.body.trails.map(nearbyTrail => {
//               let localTrails = new Trail(nearbyTrail);
//               SQL = `INSERT INTO trails
//                     (name, location, length, stars, star_votes, summary, trail_url, condition_details, condition_date, condition_time, location_id)
//                     VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`;

//   // store it in database
//               values = [localTrails.name, localTrails.location, localTrails.length, localTrails.stars, localTrails.star_votes, localTrails.summary, localTrails.trail_url, localTrails.condition_details, localTrails.condition_date, localTrails.condition_time, req.query.data.id]
//               console.log(localTrails.conditionDetails);
//               client.query(SQL, values);
//               return(localTrails);
//             })
          
//   // then send it back
//             res.status(200).send(hikeSuggestions);
//           })
//         .catch(err => {
//           console.error(err);
//           res.send(err)
//           })
//       }
//     })
//   .catch(err => {
//     console.error(err);
//     res.send(err)
//   })
// })

// // Constructors

// function Trail(nearbyTrail) {
//   this.name = nearbyTrail.name;
//   this.location = nearbyTrail.location;
//   this.length = nearbyTrail.length;
//   this.stars = nearbyTrail.stars;
//   this.star_votes = nearbyTrail.starVotes;
//   this.summary = nearbyTrail.summary;
//   this.trail_url = nearbyTrail.trail_url;
//   this.condition_details = nearbyTrail.conditionDetails;
//   this.condition_date = nearbyTrail.conditionDate.slice(0,9);
//   this.condition_time = nearbyTrail.conditionDate.slice(11,18);
// }

// function Location(location){
//   this.formatted_query = location.formatted_address;
//   this.latitude = location.geometry.location.lat;
//   this.longitude = location.geometry.location.lng;
//   this.short_name = location.address_components[0].short_name;
// }

// function Forecast(dailyForecast){
//   this.time = new Date(dailyForecast.time * 1000).toDateString();
//   this.forecast = dailyForecast.summary;
// }

// function Yelp(business){
//   this.name = business.name;
//   this.image_url = business.image_url;
//   this.price = business.price;
//   this.rating = business.rating;
//   this.url = business.url;
// }

// function Movie(newMovie){
//   this.title = newMovie.title;
//   this.overview = newMovie.overview;
//   this.average_votes = newMovie.vote_average;
//   this.total_votes = newMovie.vote_count;
//   this.image_url = 'https://image.tmdb.org/t/p/w200_and_h300_bestv2/' + newMovie.poster_path;
//   this.popularity = newMovie.popularity;
//   this.released_on = newMovie.release_date;
// }

// function Meetup(upcomingMeetup) {
//   this.link = upcomingMeetup.link;
//   this.name = upcomingMeetup.name;
//   this.creation_date = new Date(upcomingMeetup.group.created).toDateString();
//   this.host = upcomingMeetup.group.name;
// }
