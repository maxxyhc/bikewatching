mapboxgl.accessToken = 'pk.eyJ1IjoieWNoNzc5NDgiLCJhIjoiY203ZTlmdGM1MGJzYjJ0b2NzbGQ3bGJ0NyJ9.t4l1UHcRc8nLLyo1e_4INw';

// Initialize the map
const map = new mapboxgl.Map({
    container: 'map',
    style: 'mapbox://styles/mapbox/navigation-day-v1',
    center: [-71.09415, 42.36027], 
    zoom: 12,
    minZoom: 5,
    maxZoom: 18
});

let stationFlow = d3.scaleQuantize().domain([0,1]).range([0 ,0.5 ,1]);
let filteredTrips;
let circles;

map.on('load', () => {

    const bikeLaneStyle = {
        'line-width': 5,
        'line-opacity': 0.6
    };

    map.addSource('boston_route', {
        type: 'geojson',
        data: 'https://bostonopendata-boston.opendata.arcgis.com/datasets/boston::existing-bike-network-2022.geojson?...'
    });

    map.addLayer({
        id: 'bike-lanes',
        type: 'line',
        source: 'boston_route',
        paint: { ...bikeLaneStyle, 'line-color': 'blue' }
    });

    map.addSource('cambridge_route', {
        type: 'geojson',
        data: 'https://raw.githubusercontent.com/cambridgegis/cambridgegis_data/main/Recreation/Bike_Facilities/RECREATION_BikeFacilities.geojson'
    });

    map.addLayer({
        id: 'bike-lanes-cambridge',
        type: 'line',
        source: 'cambridge_route',
        paint: { ...bikeLaneStyle, 'line-color': '#FF5733' }
    });

    const svg = d3.select('#map').select('svg');
    let stations = [];
    let trips = [];
    let filteredStations = [];

    function getCoords(station) {
        const point = new mapboxgl.LngLat(+station.lon, +station.lat);
        const { x, y } = map.project(point);
        return { cx: x, cy: y };
    }

    function minutesSinceMidnight(date) {
        return date.getHours() * 60 + date.getMinutes();
    }

    function computeStationTraffic(stations, trips) {
        const departures = d3.rollup(trips, (v) => v.length, (d) => d.start_station_id);
        const arrivals = d3.rollup(trips, (v) => v.length, (d) => d.end_station_id);

        return stations.map((station) => {
            let id = station.short_name;
            return {
                ...station,
                arrivals: arrivals.get(id) ?? 0,
                departures: departures.get(id) ?? 0,
                totalTraffic: (arrivals.get(id) ?? 0) + (departures.get(id) ?? 0)
            };
        });
    }

    function filterTripsByTime() {
        filteredTrips = timeFilter === -1
            ? trips
            : trips.filter(trip => {
                const startedMinutes = minutesSinceMidnight(trip.started_at);
                const endedMinutes = minutesSinceMidnight(trip.ended_at);
                return (
                    Math.abs(startedMinutes - timeFilter) <= 60 ||
                    Math.abs(endedMinutes - timeFilter) <= 60
                );
            });

        console.log("Filtered Trips Count:", filteredTrips.length);
        filteredStations = computeStationTraffic(stations, filteredTrips);
        updateVisualization(filteredStations);
    }

    function updateVisualization(stations) {
        if (!filteredStations || filteredStations.length === 0) {
            console.warn("No stations to update in visualization.");
            return;
        }
    
        const maxTraffic = d3.max(filteredStations, d => d.totalTraffic) || 1;
    
        // Dynamically update radius scale based on filtering
        const radiusScale = d3
            .scaleSqrt()
            .domain([0, maxTraffic])
            .range(timeFilter === -1 ? [0, 25] : [3, 50]); // Increase size when filtering
    
        // Correct circle update logic with proper key function
        circles = svg.selectAll('circle')
            .data(filteredStations, d => d.short_name) // Bind data with key
            .join(
                enter => enter.append('circle')
                    .attr('r', 0) // Start with radius 0 for smooth transition
                    .attr('fill', 'steelblue')
                    .attr('stroke', 'white')
                    .attr('stroke-width', 1)
                    .attr('opacity', 0.6)
                    .each(function(d) {
                        d3.select(this)
                          .append('title')
                          .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
                    })
                    .call(enter => enter.transition().duration(500)
                        .attr('r', d => radiusScale(d.totalTraffic))), // Animate radius change
                update => update.transition().duration(500)
                    .attr('r', d => radiusScale(d.totalTraffic)) // Smooth size change
                    .style("--departure-ratio", d => isNaN(d.departures / d.totalTraffic) ? 0.5 : stationFlow(d.departures / d.totalTraffic)),
                exit => exit.transition().duration(500)
                    .attr('r', 0)
                    .remove() // Remove circles that are no longer needed
            );

        updatePositions();
    }

    function updatePositions() {
        circles.attr('cx', d => getCoords(d).cx)
               .attr('cy', d => getCoords(d).cy);
    }

    const bikestation = 'https://dsc106.com/labs/lab07/data/bluebikes-stations.json';
    const trafficURL = 'https://dsc106.com/labs/lab07/data/bluebikes-traffic-2024-03.csv';

    Promise.all([d3.json(bikestation), d3.csv(trafficURL)]).then(([stationsData, tripsData]) => {
        stations = stationsData.data.stations;
        trips = tripsData.map(trip => ({
            ...trip,
            started_at: new Date(trip.started_at),
            ended_at: new Date(trip.ended_at)
        }));
        console.log('trips:', trips);

        stations = computeStationTraffic(stations, trips);

        const radiusScale = d3
            .scaleSqrt()
            .domain([0, d3.max(stations, (d) => d.totalTraffic)])
            .range([0, 25]);

        circles = svg.selectAll('circle')
            .data(stations, (d) => d.short_name)
            .enter()
            .append('circle')
            .attr('r', d => radiusScale(d.totalTraffic))
            .attr('fill', 'steelblue')
            .attr('stroke', 'white')
            .attr('stroke-width', 1)
            .attr('opacity', 0.6)
            .style("--departure-ratio", d => stationFlow(d.departures / d.totalTraffic)) 
            .each(function(d) {
                d3.select(this)
                  .append('title')
                  .text(`${d.totalTraffic} trips (${d.departures} departures, ${d.arrivals} arrivals)`);
            });

        updatePositions();

        map.on('move', updatePositions);
        map.on('zoom', updatePositions);
        map.on('resize', updatePositions);
        map.on('moveend', updatePositions);

        filterTripsByTime();
    }).catch(error => {
        console.error('Error loading JSON:', error);
    });

    timeSlider.addEventListener('input', () => {
        updateTimeDisplay();
        filterTripsByTime();
    });

});

let timeFilter = -1;
const timeSlider = document.getElementById('time-slider');
const selectedTime = document.getElementById('selected-time');
const anyTimeLabel = document.getElementById('any-time');

function formatTime(minutes) {
    const date = new Date(0, 0, 0, 0, minutes);
    return date.toLocaleString('en-US', { timeStyle: 'short' });
}

function updateTimeDisplay() {
    timeFilter = Number(timeSlider.value);

    if (timeFilter === -1) {
        selectedTime.textContent = '';
        anyTimeLabel.style.display = 'block';
    } else {
        selectedTime.textContent = formatTime(timeFilter);
        anyTimeLabel.style.display = 'none';
    }
}

timeSlider.addEventListener('input', updateTimeDisplay);
updateTimeDisplay();
