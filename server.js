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
  this.short_name = res.body.results[0].address_components[0].short_name;
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
    const SQL = `INSERT INTO locations (search_query, formatted_query, latitude, longitude, short_name) VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING RETURNING id;`;
    const values = [this.search_query, this.formatted_query, this.latitude, this.longitude, this.short_name];
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
      const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${this.query}&key=${process.env.GOOGLE_MAPS_API}`;
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
      const url = `https://api.darksky.net/forecast/${process.env.DARK_SKY_API}/${request.query.data.latitude},${request.query.data.longitude}`;
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
      const URL = `https://api.yelp.com/v3/businesses/search?term=restaurants&latitude=${request.query.data.latitude}&longitude=${request.query.data.longitude}`;
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
    const values = [this.title, this.overview, this.average_votes, this.total_votes, this.image_url, this.popularity, this.released_on, location_id];
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
      const url = `https://api.themoviedb.org/3/search/movie?api_key=${process.env.MOVIES_DB_API}&query=${request.query.data.short_name}`;
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

Meetup.tableName = 'meetups';
Meetup.lookup = lookup;

Meetup.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (link, name, creation_date, host, location_id) VALUES($1, $2, $3, $4, $5)`;
    const values = [this.link, this.name, this.creation_date, this.host, location_id];
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
      const url = `https://api.meetup.com/find/upcoming_events?sign=true&photo-host=public&lon=${request.query.data.longitude}&page=20&lat=${request.query.data.latitude}&key=${process.env.MEETUPS_API_KEY}`;
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
  this.condition_date = nearbyTrail.conditionDate.slice(0,10);
  this.condition_time = nearbyTrail.conditionDate.slice(11,18);
}

Trail.tableName = 'trails';
Trail.lookup = lookup;

Trail.prototype = {
  save: function(location_id) {
    const SQL = `INSERT INTO ${this.tableName} (name, location, length, stars, star_votes, summary, trail_url, condition_details, condition_date, condition_time, location_id)
    VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`
    const values = [this.name, this.location, this.length, this.stars, this.star_votes, this.summary, this.trail_url, this.condition_details, this.condition_date, this.condition_time, location_id];
    client.query(SQL, values);
  }
}

function getTrails(request, response) {
  const trailHandler = {
    tableName: Trail.tableName,
    location: request.query.data.id,
    cacheHit: function (result) {
      response.send(result.rows);
    },
    cacheMiss: function () {
      const url = `https://www.hikingproject.com/data/get-trails?lat=${request.query.data.latitude}&lon=${request.query.data.longitude}&key=${process.env.HIKING_PROJECT_API_KEY}`;
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