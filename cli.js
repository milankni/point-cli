#!/usr/bin/env -S node --harmony
'use strict'

/*
 * Dependencies
 */
const cmd = require('commander')
const Configstore = require('configstore')
const pkg = require('./package.json')
const chalk = require('chalk')
const axios = require('axios')
const dateFormat = require('dateformat')
const co = require('co')
const prompt = require('co-prompt')
const _ = require('lodash')
const util = require('util')

/*
 * Constants
 */
const conf = new Configstore(pkg.name)
const apiURL = 'https://api.minut.com/draft1'
let req = axios.create({
  baseURL: apiURL,
  headers: {'Authorization': `Bearer ${conf.get('token')}`}
})

/*
 * Methods
 */

 // Authorise the user
function auth (client_id, username, password) {
  var config = {
    baseURL: apiURL,
    params: {
      client_id: client_id,
      grant_type: 'password',
      username: username,
      password: password
    }
  }

  axios.get('/auth/token', config)
  .then(function (res) {
    conf.set('token', res.data.access_token)
    console.log(chalk.green('Access token generated and saved!'))
  })
  .then(fetchDevices)
  .catch(function (res) {
    console.log(chalk.yellow(res.data.message))
  })
}

// Fetch all known devices for user and store
function fetchDevices () {
  let config = {
    baseURL: apiURL,
    headers: {'Authorization': `Bearer ${conf.get('token')}`}
  }

  console.log(chalk.green('Fetching Points...'))

  axios.get('/devices', config)
    .then(function (res) {
      console.log(`Found ${res.data.devices.length} Point`)
      let allDevices = _.map(res.data.devices, function (n) {
        console.log(`Name: ${n.description}`)
        return {id: n.device_id, name: n.description}
      })
      conf.set('devices', allDevices)
    })
    .catch(function (res) {
      console.log(chalk.red(res.data.message))
    })
}

// Check authentication and exit if not authroised yet
function checkAuth (args) {
  if (conf.get('token')) {
    return true
  } else {
    console.log(chalk.yellow(`You don't have an access token yet! Run ${chalk.underline('point auth')} to get started.`))
    process.exit(1)
  }
}

// Get a device of the name if recognised otherwise retrieve the first available
function getDevice (deviceName) {
  let devices = conf.get('devices')
  return _.find(devices, ['name', deviceName]) || _.first(devices)
}

// Format the date to make it look nicer
function formatDate (date) {
  return dateFormat(date, 'HH:MM dd/mm/yyyy')
}

// Remove colons from event type and start case all words
function timelinePrettier (s) {
  let prettyString = _.chain(s)
                      .replace(/:/g, ' ')
                      .startCase()
                      .value()
  return prettyString
}

/*
 * Commands
 */

/**
  * Get current version
  */
cmd.version(pkg.version)

/**
  * Generate access token
  *
  * @param {string} clientID - User's unique client ID.
  * @param {string} Username - Email Address used to login to Point account.
  * @param {string} Password - Password used to login to Point account.
  */
cmd
  .command('auth')
  .description('Authenticates user & generates access token.')
  .action(function (args, opts) {
    co(function *() {
      var clientID = yield prompt('Client ID: ')
      var username = yield prompt('Username: ')
      var password = yield prompt.password('Password: ')
      auth(clientID, username, password)
    })
  })

cmd
  .command('logout')
  .description('Logs out of point-cli by deleting the stored api key and devices')
  .action(function () {
    conf.clear()
  })

/**
  * Fetches Devices
  *
  * @return {Array.<string>} - Device Name and ID
  */
cmd
  .command('fetch')
  .description('Fetch new devices that have been installed')
  .action(function () {
    checkAuth()

    fetchDevices()
  })

/**
  * Lists Devices
  *
  * @param {string} clientID - User's unique client ID.
  * @param {string} Username - Email Address used to login to Point account.
  * @param {string} Password - Password used to login to Point account.
  * @return {Array.<string>} - Device Name and ID
  */
cmd
  .command('devices')
  .description('Gets all Points of user.')
  .option('-v, --verbose', 'Displays verbose details for devices')
  .option('-d, --debug', 'Full response inspection')
  .action(function (opts) {
    checkAuth()

    req.get('/devices')
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        for (var device of res.data.devices) {
          console.log('Name: ' + chalk.green(device.description))
          console.log('ID: ' + chalk.green(device.device_id))
          if (opts.verbose) {
            console.log('Online: ' + chalk.green(!device.offline ? '✔' : '✗'))
            console.log('Active: ' + chalk.green(device.active ? '✔' : '✗'))
            console.log('Last seen: ' + chalk.green(formatDate(device.last_heard_from_at)))
          }
          if (res.data.devices > 1) { console.log('\n') }
        }
      })
  })

/**
  * Get Temperature
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent temp in celsius and the timestamp
  */
cmd
  .command('temp [device]')
  .description('Gets the temperature (°C) of a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/temperature`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Temp: ' + chalk.green(`${_.round(newest.value, 2)}°C`))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get Humidity
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent humidity in percentage and the timestamp
  */
cmd
  .command('humidity [device]')
  .description('Gets the humidity (%) from a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/humidity`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Humidity: ' + chalk.green(`${newest.value}%`))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get Sound level
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent sound in db and the timestamp
  */
cmd
  .command('sound [device]')
  .alias('noise')
  .description('Gets the average sound level (db) from a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/sound_avg_levels`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Avg sound: ' + chalk.green(newest.value))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get Ambient Light Level
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent ambient light level and the timestamp
  */
cmd
  .command('light [device]')
  .alias('ambient')
  .description('Gets the average ambient light level from a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/part_als`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Avg light: ' + chalk.green(newest.value))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get Ambient Light IR Level
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent ambient light IR level and the timestamp
  */
cmd
  .command('lightir [device]')
  .alias('ambientir')
  .description('Gets the average ambient light IR level from a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/part_als_ir`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Avg light IR: ' + chalk.green(newest.value))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get Barometric Pressure Level
  *
  * @param {string} Device - Name of device
  * @return {string} - Most recent barometric pressure and the timestamp
  */
cmd
  .command('pressure [device]')
  .description('Gets the average barometric pressure from a Point (defaults to the first Point found)')
  .option('-d, --debug', 'Full response inspection')
  .action(function (device, opts) {
    checkAuth()

    let point = getDevice(device)
    console.log('Point: ' + chalk.green(point.name))

    req.get(`/devices/${point.id}/pressure`)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let newest = _.last(res.data.values)
        console.log('Avg pressure: ' + chalk.green(newest.value))
        console.log('Time: ' + chalk.green(formatDate(newest.datetime)))
      })
  })

/**
  * Get the timeline
  *
  * @param {string} event - Number of events you wish to retrieve
  * @return {string} - All the recorded events from your points timeline
  */
cmd
  .command('timeline')
  .description('Retrieve your homes timeline (defaults to 10 events)')
  .option('-l, --limit [number]', 'Specify how many events you would like to retrieve')
  .option('-d, --debug', 'Full response inspection')
  .action(function (opts) {
    checkAuth()

    var config = {
      params: {
        order: 'desc',
        //start_at: '2017-12-20 00:00:00',
        //end_at: '2018-12-20 00:00:00',
        limit: (opts.limit) ? opts.limit:10
      }
    }

    req.get('/events', config)
      .then(function (res) {
        if (opts.debug) console.log(util.inspect(res, {showHidden: true, depth: null}))

        let timeline = res.data.events

        console.log(chalk.green('→ Present'))
        for (var event of timeline) {
          console.log(chalk.green('↓'))
          console.log('Date:   ' + chalk.green(formatDate(event.created_at)))
          let text_params = event.text_params.slice(0,1)
          for (var param of text_params) {
            console.log('Device: ' + chalk.green(param.value))
          }
          console.log('Event:  ' + chalk.green(timelinePrettier(event.type)))
        }
        console.log(chalk.green('→ Past'))
      })
  })

// Kick stuff off
cmd.parse(process.argv)
