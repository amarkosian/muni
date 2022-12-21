(function($, L, Navigo){
    "use strict";

    let map;
    let stopMarkers = [];
    let vehicleMarkers = [];
    let timer;
    let youAreHere = null;

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

    function parseStops(response) {
        const stops = [];
        const validStops = [];
        const $xml = $(response);

        $xml.find('direction').each(function() {
            const $direction = $(this);

            $direction.find('stop').each(function() {
                validStops.push($(this).attr('tag'));
            });
        });

        $xml.find('stop').each(function() {
            const $elem = $(this);

            if (typeof $elem.attr('stopId') !== 'undefined' && validStops.indexOf($elem.attr('tag')) > -1) {
                stops.push({
                    id: $elem.attr('tag'),
                    tag: $elem.attr('tag'),
                    title: $elem.attr('title'),
                    lat: $elem.attr('lat'),
                    lon: $elem.attr('lon'),
                    stopId: $elem.attr('stopId')
                });
            }
        });
        return stops;
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
        console.log(vehicle);
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

        activity.forEach(function(vehicle) {
            if (vehicle.hasOwnProperty('MonitoredVehicleJourney')) {
                if (vehicle.MonitoredVehicleJourney.hasOwnProperty('LineRef')) {
                    if (vehicle.MonitoredVehicleJourney.LineRef === lineID) {
                        routeVehicles.push(vehicle['MonitoredVehicleJourney']);
                    }
                }
            }
        });

        //console.log(routeVehicles);
        clearMarkers(vehicleMarkers);
        vehicleMarkers = routeVehicles.map(function (vehicle) {
            return vehicleMarker(vehicle, map);
        });

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

        clearInterval(timer);
        // get stops in here

        fetch(url)
            .then((response) => response.json())
            .then((data) => getVehicles(data, route));
    }

    function populateRoutes(data) {
        console.log(data);
        const $optgroup = $('<optgroup label="routes">');

        $optgroup.append(makeOption('Select a route', ''));

        data.sort(function(a, b) {
            var textA = a.Id.toUpperCase();
            var textB = b.Id.toUpperCase();
            return (textA < textB) ? -1 : (textA > textB) ? 1 : 0;
        });

        data.forEach(function(route) {
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

        const root = '/muni';
        const useHash = true;
        const hash ='#';
        const router = new Navigo(root, useHash, hash);

        createMap(mapOptions);

        fetch('https://api.511.org/transit/lines?api_key=e4deb948-2e61-42d4-8b9b-6d3333cd60da&operator_id=SF&format=json')
            .then((response) => response.json())
            .then((data) => populateRoutes(data));
        //


        /*
        $.ajax({
            url: 'data.php?command=routes',
            success: function(response) {
                const routes = parseRoutes(response);
                const $optgroup = $('<optgroup label="routes">');

                $optgroup.append(makeOption('Select a route', ''));

                routes.forEach(function(route) {
                    $optgroup.append(makeOption(route.title, route.tag));
                });

                $routes.append($optgroup);

                if (router && router.lastRouteResolved()) {
                    $routes.val(router.lastRouteResolved().params.route);
                }

            }
        });
        */

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