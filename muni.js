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
    // Timestamp (ms since epoch) when we last received a valid user location update
    let lastLocationTimestamp = 0;
    // How long without an update before we consider the watch stale and try to re-init
    const GEO_STALE_MS = 2 * 60 * 1000; // 2 minutes

    // Periodic watchdog interval id for ensuring geolocation is active
    let geolocationWatchdogInterval = null;

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

        // Avoid starting multiple watches
        if (watchId !== null) return;

        const options = {
            enableHighAccuracy: true,
            timeout: 10000,
            maximumAge: 60000 // Cache position for 1 minute
        };

        const startWatch = () => {
            try {
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
                console.log('Geolocation watch started, id=', watchId);
            } catch (err) {
                console.warn('Failed to start geolocation watch:', err);
            }
        };

        // Use Permissions API when available to avoid repeatedly prompting user
        if (navigator.permissions && navigator.permissions.query) {
            navigator.permissions.query({ name: 'geolocation' })
                .then((perm) => {
                    if (perm.state === 'denied') {
                        console.warn('Geolocation permission is denied.');
                        return;
                    }
                    startWatch();
                })
                .catch(() => startWatch());
        } else {
            startWatch();
        }
    }

    /**
     * Update or create the user's location marker and optional accuracy circle.
     * Centers the map on the user the first time a position is received.
     * @param {GeolocationPosition} position
     */
    function updateUserLocation(position) {
        // Defensive validation of position object
        if (!position || !position.coords) return;
        const lat = Number(position.coords.latitude);
        const lng = Number(position.coords.longitude);
        const accuracy = Number(position.coords.accuracy || 0);

        if (!isFinite(lat) || !isFinite(lng)) {
            console.warn('Received invalid geolocation coordinates, ignoring update.');
            return;
        }

        // Update last seen timestamp so we can detect stale watches
        lastLocationTimestamp = Date.now();

        // Center map only once on the user's location for better UX.
        if (!isInitialLocationSet) {
            map.setView([lat, lng], 16); // closer zoom focused on the user
            isInitialLocationSet = true;
        }

        // Clear previous user location layers (marker + accuracy circle).
        userLocationLayer.clearLayers();

        // Create a prominent circle marker for the user.
        userLocationMarker = L.circleMarker([lat, lng], {
            radius: 8,
            color: '#2196F3',
            weight: 3,
            fillColor: '#2196F3',
            fillOpacity: 0.7
        }).bindPopup(`
            <b>Your Location</b><br>
            Accuracy: ${Math.round(accuracy)} meters<br>
            Lat: ${lat.toFixed(6)}<br>
            Lng: ${lng.toFixed(6)}
        `);

        // Add an accuracy circle when the reported accuracy is reasonable.
        if (isFinite(accuracy) && accuracy < 1000) {
            const accuracyCircle = L.circle([lat, lng], {
                radius: accuracy,
                color: '#2196F3',
                weight: 1,
                fillColor: '#2196F3',
                fillOpacity: 0.1
            });
            userLocationLayer.addLayer(accuracyCircle);
        }

        userLocationLayer.addLayer(userLocationMarker);
        console.log(`User location updated: ${lat}, ${lng} (±${Math.round(accuracy)}m)`);
    }

    /**
     * Translate geolocation API errors into user-facing messages and logs.
     * @param {GeolocationPositionError} error
     */
    function handleGeolocationError(error) {
        // Use numeric codes for broader compatibility
        switch (error.code) {
            case 1: // PERMISSION_DENIED
                console.warn('Location access denied by user.');
                alert('Location access was denied. The map will remain centered on San Francisco.');
                // Stop any existing watch and mark timestamp so ensure logic can re-init later
                if (watchId !== null) {
                    try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
                    watchId = null;
                }
                lastLocationTimestamp = 0;
                break;
            case 2: // POSITION_UNAVAILABLE
                console.warn('Location information is unavailable.');
                break;
            case 3: // TIMEOUT
                console.warn('Location request timed out.');
                break;
            default:
                console.warn('An unknown error occurred while retrieving location.');
                break;
        }
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
            try { navigator.geolocation.clearWatch(watchId); } catch (e) {}
            watchId = null;
        }
        lastLocationTimestamp = 0;
        // Clear watchdog if running
        if (geolocationWatchdogInterval !== null) {
            clearInterval(geolocationWatchdogInterval);
            geolocationWatchdogInterval = null;
        }
    }

    // Try to re-init geolocation when the watch looks stale or was cleared
    function ensureGeolocationActive() {
        if (!navigator.geolocation) return;
        // If we have a recent update, nothing to do
        if (Date.now() - lastLocationTimestamp < GEO_STALE_MS) return;
        // If a watch is already active, nothing to do
        if (watchId !== null) return;

        console.log('Geolocation appears stale or stopped; attempting to re-initialize.');
        initGeolocation();
    }

    // Hook to restart geolocation on visibility/focus (helps when browser throttles background tabs)
    // When the page becomes hidden/blurred or is unloaded, stop the geolocation watch so
    // the app does not continue consuming battery or attempt updates while the user is away.
    // When the page becomes visible/shown/focused again, attempt to restart the watch.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
            // Page moved to background: stop active geolocation to conserve battery
            cleanupGeolocation();
            console.log('Page hidden — geolocation stopped.');
        } else {
            // Page became visible again: try to re-initialize
            ensureGeolocationActive();
            // Restart watchdog if it was cleared while backgrounded
            if (geolocationWatchdogInterval === null) {
                geolocationWatchdogInterval = setInterval(ensureGeolocationActive, 30 * 1000);
            }
            console.log('Page visible — attempting to restart geolocation.');
        }
    });

    // Some mobile browsers use pagehide/pageshow; handle those as well.
    window.addEventListener('pagehide', () => {
        cleanupGeolocation();
        console.log('pagehide — geolocation stopped.');
    });
    window.addEventListener('pageshow', () => {
        ensureGeolocationActive();
        if (geolocationWatchdogInterval === null) {
            geolocationWatchdogInterval = setInterval(ensureGeolocationActive, 30 * 1000);
        }
        console.log('pageshow — attempting to restart geolocation.');
    });

    // Also handle blur/focus for extra coverage (desktop browsers).
    window.addEventListener('blur', () => {
        cleanupGeolocation();
        console.log('Window blur — geolocation stopped.');
    });
    window.addEventListener('focus', () => {
        ensureGeolocationActive();
        if (geolocationWatchdogInterval === null) {
            geolocationWatchdogInterval = setInterval(ensureGeolocationActive, 30 * 1000);
        }
        console.log('Window focus — attempting to restart geolocation.');
    });

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
            if (!response.ok) {
                console.error(`Failed to fetch routes: HTTP ${response.status}`);
                alert("Could not load SFMTA routes. Please try again later.");
                return;
            }
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
     * Fetch arrival predictions for a specific stop and format them as HTML.
     * @param {string} stopId - The ID of the stop (monitoringRef).
     * @returns {Promise<string>} HTML content for the popup.
     */
    async function fetchStopPredictions(stopId) {
        const url = `https://api.511.org/transit/stoptimetable?api_key=${API_KEY}&operatorref=${AGENCY}&monitoringref=${stopId}&format=json`;
        try {
            const response = await fetch(url, { cache: 'no-cache' });
            if (!response.ok) {
                console.error(`Prediction fetch failed for stop ${stopId}: HTTP ${response.status}`);
                return 'Could not load arrival predictions.';
            }
            const data = await response.json();
            const visits = data?.Siri?.ServiceDelivery?.StopTimetableDelivery?.TimetabledStopVisit;

            if (!visits || visits.length === 0) {
                return 'No upcoming arrivals scheduled.';
            }

            // Limit to a reasonable number of predictions
            const maxPredictions = 5;
            let predictionsHtml = '<b>Upcoming Arrivals:</b><ul style="list-style-type: none; padding-left: 0;">';

            visits.slice(0, maxPredictions).forEach(visit => {
                const journey = visit.TargetedVehicleJourney;
                const call = journey.TargetedCall;
                // ExpectedArrivalTime includes real-time data; AimedArrivalTime is scheduled. Prioritize expected.
                const arrivalTimeStr = call.AimedArrivalTime;
                if (!arrivalTimeStr) return;

                const arrivalTime = new Date(arrivalTimeStr);
                const now = new Date();
                const minutesUntil = Math.round((arrivalTime - now) / (1000 * 60));

                // Display relative time if it's soon, otherwise the absolute time.
                let timeDisplay;
                if (minutesUntil < 1) {
                    timeDisplay = '<b>Now</b>';
                } else if (minutesUntil <= 60) {
                    timeDisplay = `<b>${minutesUntil} min</b>`;
                } else {
                    timeDisplay = arrivalTime.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                }

                const lineName = journey.LineRef;
                const destination = journey.DestinationName;
                predictionsHtml += `<li><b>${lineName}</b> to ${destination}: ${timeDisplay}</li>`;
            });
            predictionsHtml += '</ul>';
            return predictionsHtml;

        } catch (error) {
            console.error(`Failed to parse or fetch predictions for stop ${stopId}:`, error);
            return 'Error fetching arrival predictions.';
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
                    const marker = L.circleMarker([stop.Location.Latitude, stop.Location.Longitude], {
                        radius: 4, color: 'black', fillColor: 'black', fillOpacity: 1
                    }).addTo(stopLayer);

                    // When a stop is clicked, open a popup and fetch arrival predictions.
                    marker.on('click', async (e) => {
                        const popup = L.popup()
                            .setLatLng(e.latlng)
                            .setContent(`<b>Stop:</b> ${stop.Name} (${stop.id})<br>Loading predictions...`)
                            .openOn(map);

                        try {
                            const predictionsHtml = await fetchStopPredictions(stop.id);
                            popup.setContent(`<b>Stop:</b> ${stop.Name} (${stop.id})<br>${predictionsHtml}`);
                        } catch (err) {
                            popup.setContent(`<b>Stop:</b> ${stop.Name} (${stop.id})<br>Could not load predictions.`);
                            console.error('Error setting popup content:', err);
                        }
                    });
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

        // Watch for permission changes and re-init geolocation when granted
        if (navigator.permissions && navigator.permissions.query) {
            try {
                navigator.permissions.query({ name: 'geolocation' }).then((perm) => {
                    // If permission status changes (e.g., user grants permission), try to ensure geolocation is active
                    perm.onchange = () => {
                        console.log('Geolocation permission changed to', perm.state);
                        if (perm.state === 'granted') {
                            ensureGeolocationActive();
                        }
                    };
                }).catch(() => {});
            } catch (e) {}
        }

        // Start a small watchdog to re-init geolocation if updates stop (helps on some platforms)
        geolocationWatchdogInterval = setInterval(ensureGeolocationActive, 30 * 1000);

        // Ensure geolocation watch is cleared when the user leaves the page
        window.addEventListener('beforeunload', cleanupGeolocation);
    }

    // Expose helper globally so external UI controls can center on the user.
    window.centerOnUserLocation = centerOnUserLocation;

    // Start the app
    init();
});

