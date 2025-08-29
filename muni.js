document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    const API_KEY = 'e4deb948-2e61-42d4-8b9b-6d3333cd60da';
    const AGENCY = 'SF';
    const SF_LATITUDE = 37.7749;
    const SF_LONGITUDE = -122.4194;
    const MAP_ZOOM = 13;

    // --- UI Elements ---
    const routeSelect = document.getElementById('route-select');
    const loader = document.getElementById('loader');

    // --- Map Initialization ---
    const map = L.map('map').setView([SF_LATITUDE, SF_LONGITUDE], MAP_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // --- Map Layers ---
    let stopLayer = L.layerGroup().addTo(map);
    let vehicleLayer = L.layerGroup().addTo(map);

    // --- Helper Functions ---
    const toggleLoader = (show) => {
        loader.style.display = show ? 'block' : 'none';
    };

    // --- Core Application Logic ---

    /**
     * Fetches all routes and populates the dropdown.
     */
    async function fetchRoutes() {
        toggleLoader(true);
        const url = `https://api.511.org/transit/lines?api_key=${API_KEY}&operator_id=${AGENCY}&format=json`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const routes = await response.json();

            routes.sort((a, b) => {
                const idA = a.Id.replace(/\D/g, '');
                const idB = b.Id.replace(/\D/g, '');
                if (idA.length && idB.length) {
                    return parseInt(idA) - parseInt(idB);
                }
                return a.Id.localeCompare(b.Id);
            });

            routes.forEach(route => {
                const option = new Option(`${route.Id} - ${route.Name}`, route.Id);
                routeSelect.add(option);
            });
        } catch (error) {
            console.error("Failed to fetch routes:", error);
            alert("Could not load SFMTA routes. Please try again later.");
        } finally {
            toggleLoader(false);
        }
    }

    /**
     * Clears map layers and fetches all new data for the selected route.
     * @param {string} routeId The ID of the route to display.
     */
    async function updateMapForRoute(routeId) {
        if (!routeId) return; // No route selected, do nothing.

        toggleLoader(true);

        // Fetch and display both stops and vehicles concurrently
        await Promise.all([
            fetchAndDisplayStops(routeId),
            fetchAndDisplayVehicles(routeId)
        ]);

        toggleLoader(false);
    }

    /**
     * Fetches and displays stops for a given route.
     * @param {string} routeId - The ID of the selected route.
     */
    async function fetchAndDisplayStops(routeId) {
        const url = `https://api.511.org/transit/stops?api_key=${API_KEY}&operator_id=${AGENCY}&line_id=${routeId}&format=json`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            const stops = data.Contents?.dataObjects?.ScheduledStopPoint || [];

            stops.forEach(stop => {
                if (stop.Location?.Latitude && stop.Location?.Longitude) {
                    L.circleMarker([stop.Location.Latitude, stop.Location.Longitude], {
                        radius: 4, color: 'black', fillColor: 'black', fillOpacity: 1
                    }).bindPopup(`<b>Stop:</b> ${stop.Name} (${stop.id})`).addTo(stopLayer);
                }
            });
        } catch (error) {
            console.error(`Failed to fetch stops for route ${routeId}:`, error);
        }
    }

    /**
     * Fetches vehicle data and filters it for the selected route.
     * @param {string} routeId - The ID of the selected route.
     */
    async function fetchAndDisplayVehicles(routeId) {
        const url = `https://api.511.org/transit/VehicleMonitoring?api_key=${API_KEY}&agency=${AGENCY}&format=json`;
        try {
            // **FIX 1: Add cache-busting option to the fetch call**
            const response = await fetch(url, { cache: 'no-cache' });
            const data = await response.json();
            const allVehicles = data.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.VehicleActivity || [];

            const routeVehicles = allVehicles.filter(v => v.MonitoredVehicleJourney?.LineRef === routeId);

            routeVehicles.forEach(vehicle => {
                const journey = vehicle.MonitoredVehicleJourney;
                if (journey.VehicleLocation?.Latitude && journey.VehicleLocation?.Longitude) {
                    const color = journey.DirectionRef === 'IB' ? 'red' : '#a934e5';
                    L.circleMarker([journey.VehicleLocation.Latitude, journey.VehicleLocation.Longitude], {
                        radius: 8, color: 'white', weight: 2, fillColor: color, fillOpacity: 0.9
                    }).bindPopup(`<b>Vehicle:</b> ${journey.VehicleRef}<br><b>Direction:</b> ${journey.DirectionRef === 'IB' ? 'Inbound' : 'Outbound'}`)
                        .addTo(vehicleLayer);
                }
            });
        } catch (error) {
            console.error(`Failed to fetch vehicles for route ${routeId}:`, error);
        }
    }

    /**
     * Handles the 'change' event from the route selection dropdown.
     */
    function handleRouteChange() {
        const selectedRoute = routeSelect.value;
        location.hash = selectedRoute || '';
    }

    /**
     * Reads the route ID from the URL hash and updates the application state.
     */
    function processUrlHash() {
        const routeId = location.hash.replace('#', '');

        // **FIX 2: Clear layers here for an immediate visual response.**
        stopLayer.clearLayers();
        vehicleLayer.clearLayers();

        if (routeSelect.querySelector(`option[value="${routeId}"]`)) {
            routeSelect.value = routeId;
            updateMapForRoute(routeId);
        } else {
            routeSelect.value = "";
            // No need to call updateMapForRoute, as layers are already cleared.
        }
    }

    /**
     * Initializes the application.
     */
    async function init() {
        await fetchRoutes();
        processUrlHash();

        routeSelect.addEventListener('change', handleRouteChange);
        window.addEventListener('hashchange', processUrlHash);
    }

    // Start the application
    init();
});