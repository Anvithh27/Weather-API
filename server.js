const express = require('express');
const axios = require('axios');
const client = require('prom-client');
const path = require('path');
const os= require('os');



const app = express();
const port = 4000;
const API_KEY = 'c75a014d58c078d007f5bb91cca294a1'; // Replace with your OpenWeatherMap key

// ---------- Prometheus Metrics Setup ---------- //
const collectDefaultMetrics = client.collectDefaultMetrics;
collectDefaultMetrics();

const totalRequests = new client.Counter({
  name: 'weather_api_requests_total',
  help: 'Total number of requests to /weather endpoint',
});

const successCounter = new client.Counter({
  name: 'weather_api_success_total',
  help: 'Number of successful weather API responses',
});

const errorCounter = new client.Counter({
  name: 'weather_api_error_total',
  help: 'Number of failed weather API responses',
});

const statusCodeCounter = new client.Counter({
  name: 'weather_api_status_codes_total',
  help: 'Count of responses by status code',
  labelNames: ['code'],
});

const requestDuration = new client.Histogram({
  name: 'weather_api_duration_seconds',
  help: 'Duration of /weather endpoint HTTP requests in seconds',
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2, 3],
});

const responseSizeHistogram = new client.Histogram({
  name: 'weather_api_response_size_bytes',
  help: 'Size of response payload in bytes',
  buckets: [100, 500, 1000, 2000, 5000],
});

const inProgressGauge = new client.Gauge({
  name: 'weather_api_in_progress_requests',
  help: 'Number of weather requests currently being processed',
});

const cityRequestCounter = new client.Counter({
  name: 'weather_api_city_requests_total',
  help: 'Total number of requests per city',
  labelNames: ['city'],
});

const externalApiDuration = new client.Histogram({
  name: 'weather_external_api_duration_seconds',
  help: 'Duration of external API call to OpenWeatherMap',
  buckets: [0.05, 0.1, 0.3, 0.5, 1, 2]
});

const weatherConditionCounter = new client.Counter({
  name: 'weather_api_condition_count',
  help: 'Count of weather conditions returned',
  labelNames: ['condition']
});

const temperatureGauge = new client.Gauge({
  name: 'weather_api_last_temperature',
  help: 'Last temperature recorded',
  labelNames: ['city']
});

const errorTypeCounter = new client.Counter({
  name: 'weather_api_error_types',
  help: 'Types of errors encountered in /weather',
  labelNames: ['type']
});
const youtubeDuration = new client.Histogram({
  name: 'youtube_link_duration_seconds',
  help: 'Time taken to load YouTube link',
  buckets: [0.1, 0.3, 0.5, 1, 2, 3, 5]
});

client.register.registerMetric(youtubeDuration);


app.get('/youtube', async (req, res) => {
  const end = youtubeDuration.startTimer();
  const link = 'https://youtu.be/krUdJ87uxXc?si=k4nTvQ8nqou5NN0k';

  try {
    await axios.get(link);
    res.sendStatus(200);
  } catch (err) {
    res.sendStatus(500);
  } finally {
    end();
  }
});

// ---------- Serve Static HTML ---------- //
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});

// ---------- Weather Endpoint ---------- //
app.get('/weather', async (req, res) => {
  totalRequests.inc();
  inProgressGauge.inc();
  const end = requestDuration.startTimer();

  try {
    const city = req.query.city || 'Hyderabad';

    const url = `https://api.openweathermap.org/data/2.5/weather?q=${city}&appid=${API_KEY}&units=metric`;
    const extEnd = externalApiDuration.startTimer();
    const response = await axios.get(url);
    extEnd();

    const data = response.data;
    cityRequestCounter.inc({ city });

    // Record weather condition and temperature
    const condition = data.weather?.[0]?.main || 'Unknown';
    const temp = data.main?.temp;
    weatherConditionCounter.inc({ condition });
    temperatureGauge.set({ city }, temp);

    // Measure response size
    const json = JSON.stringify(data);
    const byteSize = Buffer.byteLength(json, 'utf8');
    responseSizeHistogram.observe(byteSize);

    // Success tracking
    successCounter.inc();
    statusCodeCounter.inc({ code: '200' });
    res.json(data);

  } catch (error) {
    errorCounter.inc();
    const code = error.response?.status?.toString() || '500';
    statusCodeCounter.inc({ code });

    if (error.code === 'ECONNABORTED') {
      errorTypeCounter.inc({ type: 'timeout' });
    } else if (error.response) {
      errorTypeCounter.inc({ type: 'bad_response' });
    } else {
      errorTypeCounter.inc({ type: 'unknown' });
    }

    res.status(500).send('Error fetching weather data');
  } finally {
    inProgressGauge.dec();
    end();
  }
});

// ---------- Prometheus Metrics Endpoint ---------- //
app.get('/metrics', async (req, res) => {
  res.set('Content-Type', client.register.contentType);
  res.end(await client.register.metrics());
});

// ---------- Start Server ---------- //
app.listen(port, () => {
  console.log(`Server running at http://localhost:${port}`);
});


