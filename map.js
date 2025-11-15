// ---------- Mapbox setup ----------

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

// ---------- Global state & helpers ----------

let stations = [];
let trips = [];
let timeFilter = -1;
let svg; // D3 SVG overlay

// map departure ratio → 0, 0.5, 1 for 3-color legend
const stationFlow = d3.scaleQuantize().domain([0, 1]).range([0, 0.5, 1]);

// will set domain after loading data
let radiusScale = d3.scaleSqrt().range([0, 25]);

function getCoords(station) {
  const { lat, lon } = station;
  if (lat == null || lon == null) return { cx: -9999, cy: -9999 };
  const p = map.project([+lon, +lat]);
  return { cx: p.x, cy: p.y };
}

function formatTime(minutes) {
  const d = new Date(0, 0, 0, 0, minutes);
  return d.toLocaleString("en-US", { timeStyle: "short" });
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

  return stationsArray.map((s, idx) => {
    const id = s.short_name ?? s.station_id ?? `S${idx}`;
    const arr = arrivals.get(id) ?? 0;
    const dep = departures.get(id) ?? 0;

    s._id = id;
    s.arrivals = arr;
    s.departures = dep;
    s.totalTraffic = arr + dep;
    return s;
  });
}

// filter trips for 2-hour window
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

// ---------- main ----------

map.on("load", async () => {
  // 0) create SVG overlay in the Mapbox canvas container
  const canvasContainer = map.getCanvasContainer();
  svg = d3
    .select(canvasContainer)
    .append("svg")
    .attr("class", "stations-layer");

  // 1) Boston bike lanes
  map.addSource("boston_route", {
    type: "geojson",
    data: "https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson",
  });

  map.addLayer({
    id: "boston-bike-lanes",
    type: "line",
    source: "boston_route",
    paint: {
      "line-color": "#32d400",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  // 2) Cambridge bike lanes
  map.addSource("cambridge_route", {
    type: "geojson",
    data: "https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson",
  });

  map.addLayer({
    id: "cambridge-bike-lanes",
    type: "line",
    source: "cambridge_route",
    paint: {
      "line-color": "#32d400",
      "line-width": 3,
      "line-opacity": 0.6,
    },
  });

  // 3) load station + trip data from DSC106 (remote URLs)
  const stationsURL =
    "https://dsc106.com/labs/lab07/data/bluebikes-stations.json";
  const tripsURL =
    "https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv";

  const stationData = await d3.json(stationsURL);
  stations = stationData.data.stations.map((d) => ({
    ...d,
    lat: d.lat,
    lon: d.lon,
  }));

  trips = await d3.csv(tripsURL, (trip) => {
    trip.started_at = new Date(trip.started_at);
    trip.ended_at = new Date(trip.ended_at);
    return trip;
  });

  stations = computeStationTraffic(stations, trips);

  console.log("stations loaded:", stations.length);
  console.log("trips loaded:", trips.length);

  const maxTraffic = d3.max(stations, (d) => d.totalTraffic) || 1;
  radiusScale.domain([0, maxTraffic]).range([0, 25]);

  // 4) draw station circles
  const circles = svg
    .selectAll("circle")
    .data(stations, (d) => d._id)
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
          `${d.name}\n${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`
        );
    });

  // keep circles aligned with map
  function updatePositions() {
    svg
      .selectAll("circle")
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy);
  }

  map.on("move", updatePositions);
  map.on("zoom", updatePositions);
  map.on("resize", updatePositions);

  // ----- slider interaction -----

  const timeSlider = document.getElementById("time-slider");
  const selectedTimeEl = document.getElementById("selected-time");
  const anyTimeEl = document.getElementById("any-time");

  function updateScatterPlot(currentTimeFilter) {
    const filteredTrips = filterTripsByTime(trips, currentTimeFilter);
    const filteredStations = computeStationTraffic(stations, filteredTrips);

    currentTimeFilter === -1
      ? radiusScale.range([0, 25])
      : radiusScale.range([3, 50]);

    svg
      .selectAll("circle")
      .data(filteredStations, (d) => d._id)
      .join("circle")
      .attr("cx", (d) => getCoords(d).cx)
      .attr("cy", (d) => getCoords(d).cy)
      .attr("r", (d) => radiusScale(d.totalTraffic))
      .style("--departure-ratio", (d) =>
        stationFlow(d.totalTraffic ? d.departures / d.totalTraffic : 0.5)
      )
      .each(function (d) {
        const t = d3.select(this).select("title");
        const text = `${d.name}\n${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`;
        if (t.empty()) {
          d3.select(this).append("title").text(text);
        } else {
          t.text(text);
        }
      });
  }

  function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
      selectedTimeEl.textContent = "";
      anyTimeEl.style.display = "block";
    } else {
      selectedTimeEl.textContent = formatTime(timeFilter);
      anyTimeEl.style.display = "none";
    }

    updateScatterPlot(timeFilter);
  }

  timeSlider.addEventListener("input", updateTimeDisplay);
  updateTimeDisplay(); // initial render
});
