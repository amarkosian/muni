// Real-time SFMTA vehicle map application.
// Initializes a Leaflet map, fetches route/stop/vehicle data from the 511 API,
// watches user geolocation, and updates vehicle markers on a configurable interval.

document.addEventListener('DOMContentLoaded', () => {
    // --- Configuration ---
    // API key for 511 SFMTA endpoints (public demo key in this project).
    const API_KEY = 'e4deb948-2e61-42d4-8b9b-6d3333cd60da';
    // Operator / agency identifier used by the API.
    const AGENCY = 'SF';
    // Default map center coordinates (San Francisco) used before geolocation is available.
    const SF_LATITUDE = 37.7749;
    const SF_LONGITUDE = -122.4194;
    const MAP_ZOOM = 13;

    // Simple rate-limit settings used to compute how often to poll vehicle endpoints.
    // API_RATE_LIMIT_REQUESTS = allowed requests per API_RATE_LIMIT_SECONDS.
    const API_RATE_LIMIT_REQUESTS = 60;
    const API_RATE_LIMIT_SECONDS = 3600;
    // Compute update interval in milliseconds (e.g., 3600s / 60 req = 60s).
    const UPDATE_INTERVAL_MS = (API_RATE_LIMIT_SECONDS / API_RATE_LIMIT_REQUESTS) * 1000; // 60000ms or 60s

    // --- UI Elements (DOM references) ---
    const routeSelect = document.getElementById('route-select');
    const loader = document.getElementById('loader');
    const refreshButton = document.getElementById('refresh');

    // --- Map Initialization ---
    // Create a Leaflet map and add an OpenStreetMap tile layer.
    const map = L.map('map').setView([SF_LATITUDE, SF_LONGITUDE], MAP_ZOOM);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
    }).addTo(map);

    // --- Map Layers ---
    // Layers separate different kinds of map markers so they can be cleared independently.
    let stopLayer = L.layerGroup().addTo(map);      // static route stops
    let vehicleLayer = L.layerGroup().addTo(map);   // dynamic vehicle markers
    let userLocationLayer = L.layerGroup().addTo(map); // user location & accuracy circle

    // --- Geolocation Variables ---
    // Marker for the user's current position
    let userLocationMarker = null;
    // ID returned by navigator.geolocation.watchPosition so it can be cleared later
    let watchId = null;
    // Ensures the map is centered on the user only once (initial lock)
    let isInitialLocationSet = false;

    // Timer and state for vehicle updates
    let vehicleUpdateInterval = null; // ID for setInterval that refreshes vehicle locations

    // Map of current vehicle markers keyed by vehicleRef (unique id per vehicle)
    const currentVehicleMarkers = new Map();

    // --- Helper Functions ---

    /**
     * Show or hide a loading indicator in the UI.
     * @param {boolean} show - true to display loader, false to hide.
     */
    const toggleLoader = (show) => {
        loader.style.display = show ? 'block' : 'none';
    };

    /**
     * Produce a visually dimmed/darker hex color for previously-active markers.
     * This is used to "fade" markers that were in the last update but are not refreshed yet.
     * @param {string} originalColor
     * @returns {string} hex color
     */
    const getDimmedColor = (originalColor) => {
        // Keep logic simple and explicit for known colors.
        if (originalColor === 'red') return '#8B0000'; // Dark Red
        if (originalColor === '#a934e5') return '#6a0a8e'; // Darker Purple
        return '#808080'; // Fallback gray
    };

    // --- Geolocation Functions ---

    /**
     * Initialize geolocation: attempt to get current position and watch for updates.
     * Uses high accuracy when available and caches for 1 minute.
     */
    function initGeolocation() {
        if (!navigator.geolocation) {
            console.warn('Geolocation is not supported by this browser.');
            return;
        }

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // Cache position for 1 minute
        };

        // Get initial position (once) so we can center the map right away
        navigator.geolocation.getCurrentPosition(
            updateUserLocation,
            handleGeolocationError,
            options
        );

        // Continuously watch the user's position and update the map marker
        watchId = navigator.geolocation.watchPosition(
            updateUserLocation,
            handleGeolocationError,
            options
        );
    }

    /**
     * Update or create the user's location marker and optional accuracy circle.
     * Centers the map on the user the first time a position is received.
     * @param {GeolocationPosition} position
     */
    function updateUserLocation(position) {
        const { latitude, longitude, accuracy } = position.coords;

        // Center map only once on the user's location for better UX.
        if (!isInitialLocationSet) {
            map.setView([latitude, longitude], 16); // closer zoom focused on the user
            isInitialLocationSet = true;
        }

        // Clear previous user location layers (marker + accuracy circle).
        userLocationLayer.clearLayers();

        // Create a prominent circle marker for the user.
        userLocationMarker = L.circleMarker([latitude, longitude], {
            radius: 8,
            color: '#2196F3',
            weight: 3,
            fillColor: '#2196F3',
            fillOpacity: 0.7
        }).bindPopup(`
            <b>Your Location</b><br>
            Accuracy: ${Math.round(accuracy)} meters<br>
            Lat: ${latitude.toFixed(6)}<br>
            Lng: ${longitude.toFixed(6)}
        `);

        // Add an accuracy circle when the reported accuracy is reasonable.
        if (accuracy < 1000) {
            const accuracyCircle = L.circle([latitude, longitude], {
                radius: accuracy,
                color: '#2196F3',
                weight: 1,
                fillColor: '#2196F3',
                fillOpacity: 0.1
            });
            userLocationLayer.addLayer(accuracyCircle);
        }

        userLocationLayer.addLayer(userLocationMarker);
        console.log(`User location updated: ${latitude}, ${longitude} (±${Math.round(accuracy)}m)`);
    }

    /**
     * Translate geolocation API errors into user-facing messages and logs.
     * @param {GeolocationPositionError} error
     */
    function handleGeolocationError(error) {
        let message;
        switch (error.code) {
            case error.PERMISSION_DENIED:
                message = "Location access denied by user.";
                // Inform the user that the map will remain at the default center.
                alert("Location access was denied. The map will remain centered on San Francisco.");
                break;
            case error.POSITION_UNAVAILABLE:
                message = "Location information is unavailable.";
                break;
            case error.TIMEOUT:
                message = "Location request timed out.";
                break;
            default:
                message = "An unknown error occurred while retrieving location.";
                break;
        }
        console.warn(`Geolocation error: ${message}`);
    }

    /**
     * Center the map on the user's last known marker position.
     * Called externally from UI (exposed on window).
     */
    function centerOnUserLocation() {
        if (userLocationMarker) {
            const latLng = userLocationMarker.getLatLng();
            map.setView(latLng, 16);
        } else {
            console.warn('User location not available');
        }
    }

    /**
     * Stop watching the user's position and cleanup resources.
     * Intended to be called on page unload to avoid background geolocation activity.
     */
    function cleanupGeolocation() {
        if (watchId !== null) {
            navigator.geolocation.clearWatch(watchId);
            watchId = null;
        }
    }

    // --- Core Application Logic ---

    /**
     * Fetch all available transit lines for the agency and populate the route dropdown.
     * Sorts routes numerically when possible for a natural order in the UI.
     */
    async function fetchRoutes() {
        toggleLoader(true);
        const url = `https://api.511.org/transit/lines?api_key=${API_KEY}&operator_id=${AGENCY}&format=json`;
        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            const routes = await response.json();

            // Sort by numeric part of the id when present, otherwise lexicographically.
            routes.sort((a, b) => {
                const idA = a.Id.replace(/\D/g, '');
                const idB = b.Id.replace(/\D/g, '');
                if (idA.length && idB.length) {
                    return parseInt(idA) - parseInt(idB);
                }
                return a.Id.localeCompare(b.Id);
            });

            // Populate the route select UI with options like "38 - Geary"
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
     * Fetch and render stops for a specific route.
     * Stops are added as small black circle markers to the stopLayer.
     * @param {string} routeId
     */
    async function fetchAndDisplayStops(routeId) {
        const url = `https://api.511.org/transit/stops?api_key=${API_KEY}&operator_id=${AGENCY}&line_id=${routeId}&format=json`;
        try {
            const response = await fetch(url);
            const data = await response.json();
            // The API nests stop data under Contents -> dataObjects -> ScheduledStopPoint
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
     * Fetch vehicle positions, filter for the selected route, and update markers.
     *
     * Behavior summary:
     *  - Dims all existing markers to indicate they're from a previous update.
     *  - For each vehicle returned:
     *      * If marker exists -> move it and update its style & popup.
     *      * If new -> create a new marker and add it to vehicleLayer and Map.
     *  - Remove markers for vehicles that no longer appear in the API response.
     *
     * @param {string} routeId
     */
    async function fetchAndDisplayVehicles(routeId) {
        // Track vehicles seen in this fetch cycle so we can remove stale ones later.
        const vehiclesToKeep = new Set();

        // Visually dim all current markers before the new positions are applied.
        currentVehicleMarkers.forEach((marker) => {
            const currentStyle = marker.options;
            marker.setStyle({
                fillColor: getDimmedColor(currentStyle.fillColor),
                color: getDimmedColor(currentStyle.color) // Dim the border too
            });
        });

        const url = `https://api.511.org/transit/VehicleMonitoring?api_key=${API_KEY}&agency=${AGENCY}&format=json`;
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            const data = await response.json();
            // API places vehicles under Siri -> ServiceDelivery -> VehicleMonitoringDelivery -> VehicleActivity
            const allVehicles = data.Siri?.ServiceDelivery?.VehicleMonitoringDelivery?.VehicleActivity || [];

            // Filter vehicles to the selected route's line id
            const routeVehicles = allVehicles.filter(v => v.MonitoredVehicleJourney?.LineRef === routeId);

            routeVehicles.forEach(vehicle => {
                const journey = vehicle.MonitoredVehicleJourney;
                const vehicleRef = journey.VehicleRef; // unique per vehicle
                const newLat = journey.VehicleLocation?.Latitude;
                const newLng = journey.VehicleLocation?.Longitude;

                if (newLat && newLng) {
                    // Choose marker color by direction (example: 'IB' == inbound).
                    const color = journey.DirectionRef === 'IB' ? 'red' : '#a934e5';

                    // Build popup HTML summarizing key details for inspection.
                    let popUpHtml = `<b>Vehicle:</b> ${journey.VehicleRef}<br>`
                        + `<b>Direction:</b> ${journey.DirectionRef === 'IB' ? 'Inbound' : 'Outbound'}<br>`
                        + `<b>Destination:</b> ${journey.DestinationName}<br>`
                        + `<b>Origin:</b> ${journey.OriginName}<br>`
                        + `<b>Occupancy:</b> ${journey.Occupancy}<br>`
                        + `<b>VehicleLocation:</b> ${journey.VehicleLocation.Latitude}, ${journey.VehicleLocation.Longitude}`;

                    // If marker already exists, update its position and styling.
                    if (currentVehicleMarkers.has(vehicleRef)) {
                        const existingMarker = currentVehicleMarkers.get(vehicleRef);
                        existingMarker.setLatLng([newLat, newLng]);
                        existingMarker.setStyle({
                            radius: 8, color: 'white', weight: 2, fillColor: color, fillOpacity: 0.9
                        });
                        existingMarker.bindPopup(popUpHtml);
                    } else {
                        // New vehicle: create marker and add to the vehicle layer.
                        const newMarker = L.circleMarker([newLat, newLng], {
                            radius: 8, color: 'white', weight: 2, fillColor: color, fillOpacity: 0.9
                        }).bindPopup(popUpHtml).addTo(vehicleLayer);
                        currentVehicleMarkers.set(vehicleRef, newMarker);
                    }
                    vehiclesToKeep.add(vehicleRef); // keep this vehicle active
                }
            });

            // Remove any markers that were not present in the latest API response.
            currentVehicleMarkers.forEach((marker, vehicleRef) => {
                if (!vehiclesToKeep.has(vehicleRef)) {
                    vehicleLayer.removeLayer(marker);
                    currentVehicleMarkers.delete(vehicleRef);
                }
            });

        } catch (error) {
            console.error(`Failed to fetch vehicles for route ${routeId}:`, error);
            // If a network error occurs, restore a sensible color for previously-dimmed markers
            currentVehicleMarkers.forEach((marker) => {
                const isPopupInbound = marker.getPopup().getContent().includes("Inbound");
                const originalColor = isPopupInbound ? 'red' : '#a934e5';
                marker.setStyle({
                    fillColor: originalColor,
                    color: 'white'
                });
            });
        }
    }

    /**
     * Route select change handler.
     * Updates the URL hash which triggers `processUrlHash` to load data for the route.
     */
    function handleRouteChange() {
        const selectedRoute = routeSelect.value;
        // Using location.hash ensures the back/forward browser buttons change the displayed route.
        location.hash = selectedRoute || '';
    }

    /**
     * Manual refresh button handler.
     * Invokes a one-off fetch of vehicle locations for the currently selected route.
     */
    async function handleRefreshClick() {
        const selectedRoute = routeSelect.value;
        if (selectedRoute) {
            console.log(`Manual refresh for route ${selectedRoute}...`);
            toggleLoader(true);
            try {
                await fetchAndDisplayVehicles(selectedRoute);
            } catch (error) {
                console.error("Manual refresh failed:", error);
                alert("Could not refresh vehicle locations. Please check your connection.");
            } finally {
                toggleLoader(false);
            }
        } else {
            // Encourage the user to pick a route before refreshing.
            alert("Please select a route to refresh.");
        }
    }

    /**
     * Reads the route ID from location.hash and updates app state accordingly.
     * - Clears previous layers and markers.
     * - Loads stops and vehicles for the selected route.
     * - Starts a periodic update timer that refreshes vehicle positions only.
     */
    async function processUrlHash() {
        // Stop any previously running update interval to avoid duplicate timers.
        if (vehicleUpdateInterval) {
            clearInterval(vehicleUpdateInterval);
            vehicleUpdateInterval = null;
        }

        // Remove leading '#' from the hash
        const routeId = location.hash.replace('#', '');

        // Reset displayed data
        stopLayer.clearLayers();
        vehicleLayer.clearLayers();
        currentVehicleMarkers.clear();

        // Ensure the selected route exists in the dropdown before proceeding
        if (routeId && routeSelect.querySelector(`option[value="${routeId}"]`)) {
            routeSelect.value = routeId;
            toggleLoader(true);

            // Perform initial loads in parallel: stops (static) and vehicles (dynamic)
            await Promise.all([
                fetchAndDisplayStops(routeId),
                fetchAndDisplayVehicles(routeId)
            ]);

            // Start periodic updates for vehicles only, respecting the computed interval.
            vehicleUpdateInterval = setInterval(() => {
                console.log(`Updating vehicle locations for route ${routeId}...`);
                fetchAndDisplayVehicles(routeId);
            }, UPDATE_INTERVAL_MS);

            toggleLoader(false);

        } else {
            // No valid route selected: reset dropdown to empty state.
            routeSelect.value = "";
        }
    }

    /**
     * Application bootstrap:
     * - Load available routes
     * - Apply hash-based route selection
     * - Wire up UI event listeners
     * - Start geolocation
     */
    async function init() {
        await fetchRoutes();
        processUrlHash();

        routeSelect.addEventListener('change', handleRouteChange);
        window.addEventListener('hashchange', processUrlHash);
        refreshButton.addEventListener('click', handleRefreshClick);

        // Start geolocation tracking to show user position on the map
        initGeolocation();

        // Ensure geolocation watch is cleared when the user leaves the page
        window.addEventListener('beforeunload', cleanupGeolocation);
    }

    // Expose helper globally so external UI controls can center on the user.
    window.centerOnUserLocation = centerOnUserLocation;

    // Start the app
    init();
});

