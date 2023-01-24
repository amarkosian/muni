(function($, L, Navigo){
    "use strict";

    let map;
    let stopMarkers = [];
    let vehicleMarkers = [];
    let timer;
    let youAreHere = null;
    const root = '/muni';
    const useHash = true;
    const hash ='#';
    const router = new Navigo(root, useHash, hash);

    function parseRoutes(response) {
        return $(response).find('route').map(function () {
            const $elem = $(this);
            return {
                id: $elem.attr('tag'),
                tag: $elem.attr('tag'),
                title: $elem.attr('title')
            };
        }).toArray();
    }

    function loadStops(data, route) {
        if (data.hasOwnProperty('Contents') && data['Contents'].hasOwnProperty('dataObjects')) {
            if (data['Contents']['dataObjects'].hasOwnProperty('ScheduledStopPoint')) {
                clearMarkers(stopMarkers);
                stopMarkers = data['Contents']['dataObjects']['ScheduledStopPoint'].map(function (stop) {
                    const stopData = {
                        id: route,
                        tag: route,
                        title: stop['Name'],
                        lat: stop['Location']['Latitude'],
                        lon: stop['Location']['Longitude'],
                        stopId: stop['id']
                    };
                    return stopMarker(stopData);
                })
            }
        }
        return stopMarkers;
    }

    function makeOption(label, value) {
        return $('<option>').val(value).text(label);
    }

    function getDirection(_dirTag) {
        const dirTag = _dirTag || '';
        return dirTag.indexOf('_I_') > -1 ? 'I' : 'O';
    }


    function stopMarker(stop) {
        return L.marker([stop.lat, stop.lon], {
            title: stop.title,
            icon: L.icon({
                iconUrl: 'stop.png',
                iconSize: [10,10],
                iconAnchor: [5,5]
            })
        }).bindPopup('<div>' + stop.title + '</div>', {id: stop.id}).addTo(map);
    }

    function vehiclePopup(vehicle) {
        return '<div><h2>' + vehicle.routeTag + '</h2></div>'
            +  '<h3>Vehicle ID: <em>' + vehicle.id + '</em></h3>'
            +  '<div><strong>Direction: </strong>' + (vehicle.dirTag === 'I' ? 'Inbound' : 'Outbound') + '</div>'
            +  '<div><strong>Heading: </strong>' + vehicle.heading + '</div>'
            +  '<div><strong>Speed: </strong>' + vehicle.speedkmhr + '</div>';
    }

    function vehicleMarker(vehicle) {
        const icon = vehicle.DirectionRef === 'IB' ? 'inbound.png' : 'outbound.png';
        const marker = L.icon({
            iconUrl: icon,
            iconSize:     [15,15],
            iconAnchor:   [7,7]
        });
        return L.marker([vehicle.VehicleLocation.Latitude, vehicle.VehicleLocation.Longitude], {
            icon: marker,
            title: vehicle.LineRef,
            zIndexOffset: 1000
        }).bindPopup(vehiclePopup(vehicle)).addTo(map);
    }

    function getVehicles(data, lineID) {
        const activity = data['Siri']['ServiceDelivery']['VehicleMonitoringDelivery']['VehicleActivity'];
        let routeVehicles = [];

        clearInterval(timer);

        activity.forEach(function(vehicle) {
            if (vehicle.hasOwnProperty('MonitoredVehicleJourney')) {
                if (vehicle.MonitoredVehicleJourney.hasOwnProperty('LineRef')) {
                    if (vehicle.MonitoredVehicleJourney.LineRef === lineID) {
                        routeVehicles.push(vehicle['MonitoredVehicleJourney']);
                    }
                }
            }
        });

        clearMarkers(vehicleMarkers);
        vehicleMarkers = routeVehicles.map(function (vehicle) {
            return vehicleMarker(vehicle, map);
        });

        startVehicleTimer(lineID)
    }

    function startVehicleTimer(route) {
        timer = window.setInterval(function() {
            loadRoute(route);
        }, 9000);
    }

    function clearMarkers(markers) {
        markers.forEach(function(marker){
            map.removeLayer(marker);
        });
        markers.length = 0;
    }

    function onLocationFound(e) {
        //var radius = e.accuracy / 2;
        const radius = (e.accuracy > 50 && e.accuracy < 100) ? e.accuracy : 75;
        //L.marker(e.latlng).addTo(map).bindPopup("You are within " + radius + " meters from this point");

        if (youAreHere !== null) {
            map.removeLayer(youAreHere);
        }

        youAreHere = L.circle(e.latlng, {radius: radius, fill: true, fillOpacity: 0.75});
        youAreHere.addTo(map);
    }

    function onLocationError(e) {
        //alert(e.message);
    }

    function createMap(options) {
        map = L.map('map', options);

        // add the OpenStreetMap tiles
        L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
            attribution: '&copy; <a href="https://openstreetmap.org/copyright">OpenStreetMap contributors</a>'
        }).addTo(map);

        // show the scale bar on the lower left corner
        L.control.scale().addTo(map);

        map.on('locationfound', onLocationFound);
        map.on('locationerror', onLocationError);
        map.locate({setView : true, maxZoom: 14});
        window.setInterval(function() {
            map.locate({setView : false});
        }, 10000);
    }

    function loadRoute(route) {
        const url = 'https://api.511.org/transit/VehicleMonitoring?api_key=e4deb948-2e61-42d4-8b9b-6d3333cd60da&agency=SF&format=json';

        if (route) {
            // get stops in here
            fetch('https://api.511.org/transit/stops?api_key=e4deb948-2e61-42d4-8b9b-6d3333cd60da&operator_id=SF&line_id=' + route + '&format=json')
                .then((response) => response.json())
                .then((data) => loadStops(data, route));
            //

            fetch(url)
                .then((response) => response.json())
                .then((data) => getVehicles(data, route));
        }
    }

    function populateRoutes(data) {
        const $optgroup = $('<optgroup label="routes">');
        const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' })
        const sorted = data.sort((a, b) => collator.compare(a.Id, b.Id));

        $optgroup.append(makeOption('Select a route', ''));
        sorted.forEach(function(route) {
            const title = route.Id + ' ' + route.Name;
            const value = route.Id;
            $optgroup.append(makeOption(title, value));
        });

        $('#routes').append($optgroup);

        if (router && router.lastRouteResolved()) {
            $('#routes').val(router.lastRouteResolved().params.route);
        }
    }

    $(document).ready(function(){
        const $routes = $('#routes');
        const initialLocation = [37.74, -122.4498];
        const mapOptions = {
            center: initialLocation,
            dragging: true,
            maxZoom: 18,
            minZoom: 12,
            zoom: 12.1,
            zoomDelta: 0.5,
            zoomSnap: 0.25
        };

        createMap(mapOptions);

        fetch('https://api.511.org/transit/lines?api_key=e4deb948-2e61-42d4-8b9b-6d3333cd60da&operator_id=SF&format=json')
            .then((response) => response.json())
            .then((data) => populateRoutes(data));

        $routes.on('change', function () {
            router.navigate('/' + $(this).val());
        });

        router.on('/:route', function (params) {
            const route = params.route.toUpperCase();
            loadRoute(route);
            $routes.val(route);
        }).resolve();

    });
})(jQuery, L, Navigo);