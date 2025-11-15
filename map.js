// Import Mapbox GL and D3 as ES modules
import mapboxgl from "https://cdn.jsdelivr.net/npm/[email protected]/+esm";
import * as d3 from "https://cdn.jsdelivr.net/npm/[email protected]/+esm";

// ---------------------- Mapbox setup ------------------------

mapboxgl.accessToken =
  "pk.eyJ1Ijoiam9sMTQ1IiwiYSI6ImNtaHpzOTgweTBzbDgyanB0OXZwOWg4OHEifQ.3UNjdwsA_Bs_G0SHxotI_w";

const map = new mapboxgl.Map({
  container: "map",
  style: "mapbox://styles/mapbox/streets-v12",
  center: [-71.09415, 42.36027], // Boston / Cambridge
  zoom: 12,
  minZoom: 5,
  maxZoom: 18,
});

// ---------------------- Global state & helpers ------------------------

let stations = [];
let trips = [];
let timeFilter = -1;

const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

const svg = d3.select("#map svg");

// project station lon/lat to screen coords
function getCoords(station) {
  const point = new mapboxgl.LngLat(+station.lon, +station.lat);
  const { x, y } = map.project(point);
  return { cx: x, cy: y };
}

function formatTime(minutes) {
  const date = new Date(0, 0, 0, 0, minutes);
  return date.toLocaleString("en-US", { timeStyle: "short" });
}

function minutesSinceMidnight(date) {
  return date.getHours() * 60 + date.getMinutes();
}

// compute arrivals / departures / total per station
function computeStationTraffic(stationsArray, tripsArray) {
  const departures = d3.rollup(
    tripsArray,
    (v) => v.length,
    (d) => d.start_station_id
  );

  const arrivals = d3.rollup(
    tripsArray,
    (v) => v.length,
    (d) => d.end_station_id
  );

  return stationsArray.map((station) => {
    const id = station.short_name;
    station.departures = departures.get(id) ?? 0;
    station.arrivals = arrivals.get(id) ?? 0;
    station.totalTraffic = station.departures + station.arrivals;
    return station;
  });
}

// filter trips by selected minute (+/- 60 minutes window)
function filterTripsByTime(tripsArray, minute) {
  if (minute === -1) return tripsArray;

  return tripsArray.filter((trip) => {
    const started = minutesSinceMidnight(trip.started_at);
    const ended = minutesSinceMidnight(trip.ended_at);
    return (
      Math.abs(started - minute) <= 60 || Math.abs(ended - minute) <= 60
    );
  });
}

// ---------------------- main map logic ------------------------

map.on("load", async () => {
  // 1) bike lanes: Boston
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "boston-bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "#32D400",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  // 2) bike lanes: Cambridge
  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "#32D400",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  // 3) load station + trip data
  const stationsURL = "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  const tripsURL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  const jsonData = await d3.json(stationsURL);
  stations = jsonData.data.stations;

  trips = await d3.csv(tripsURL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  stations = computeStationTraffic(stations, trips);

  const maxTraffic = d3.max(stations, (d) => d.totalTraffic) ?? 1;

  const radiusScale = d3
    .scaleSqrt()
    .domain([0, maxTraffic])
    .range([0, 25]);

  // 4) create station circles
  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d.short_name)
    .enter()
    .append("circle")
    .attr("r", (d) => radiusScale(d.totalTraffic))
    .attr("cx", (d) => getCoords(d).cx)
    .attr("cy", (d) => getCoords(d).cy)
    .style("--departure-ratio", (d) =>
      stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5)
    )
    .each(function (d) {
      d3.select(this)
        .append("title")
        .text(
          `${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // keep circles aligned when user pans / zooms
  function updatePositions() {
    svg
      .selectAll("circle")
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);

  // ---------------- slider reactivity ----------------

  const timeSlider = document.getElementById("time-slider");
  const selectedTime = document.getElementById("selected-time");
  const anyTimeLabel = document.getElementById("any-time");

  function updateScatterPlot(currentTimeFilter) {
    const filteredTrips = filterTripsByTime(trips, currentTimeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    // change size range depending on filtering
    currentTimeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    circles
      .data(filteredStations, (d) => d.short_name)
      .join("circle")
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy)
      .attr("r", (d) => radiusScale(d.total
