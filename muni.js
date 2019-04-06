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
        return '<strong>' + vehicle.routeTag + '</strong>';
    }

    function vehicleMarker(vehicle) {
        const icon = vehicle.dirTag === 'I' ? 'inbound.png' : 'outbound.png';
        const vehicleClass = vehicle.dirTag === 'I' ? 'inbound' : 'outbound';
        const popUpOptions = {
            id: vehicle.id,
            autoClose: false,
            closeButton: false,
            className: vehicle.dirTag === 'I' ? 'inbound' : 'outbound',
            minWidth: 10
        };
        const marker = L.icon({
          iconUrl: icon,
          iconSize:     [15,15],
          iconAnchor:   [7,7]
        });
        return L.marker([vehicle.location.lat, vehicle.location.lon], {
            icon: marker,
            title: vehicle.id,
            zIndexOffset: 1000
        }).bindPopup(vehiclePopup(vehicle), popUpOptions).addTo(map).openPopup() ;
    }

    function getVehicles(response) {
        const $xml = $(response);
        return $xml.find('vehicle').map(function() {
            const $this = $(this);
            const directionTag = $this.attr('dirTag') || '';
            return {
                id: $this.attr('id'),
                dirTag: getDirection(directionTag),
                heading: $this.attr('heading'),
                location: {
                    lat: $this.attr('lat'),
                    lon: $this.attr('lon')
                },
                predictble: $this.attr('predictable'),
                routeTag: $this.attr('routeTag'),
                secssincereport: $this.attr('secsSinceReport'),
                speedkmhr: $this.attr('speedKmHr')
            }
        }).toArray();
    }

    function clearMarkers(markers) {
        markers.forEach(function(marker){
            map.removeLayer(marker);
        });
        markers.length = 0;
    }

    function updateVehicles(route) {
        const proxyurl = "https://cors-anywhere.herokuapp.com/";
        const url = "https://ersur.org/muni/data.php?command=vehicles&route=";
        $.ajax({
            url: proxyurl + url + route,
            success: function(response) {
                clearMarkers(vehicleMarkers);
                vehicleMarkers = getVehicles(response).map(function (vehicle) {
                    return vehicleMarker(vehicle, map);
                });
            }
        });
    }

    function onLocationFound(e) {
        //var radius = e.accuracy / 2;
        const radius = e.accuracy;
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

    function locate() {
        if( /Android|webOS|iPhone|iPad|iPod|BlackBerry/i.test(navigator.userAgent) ) {
            map.locate({setView : true, maxZoom: 14});
            window.setInterval(function() {
                map.locate({setView : false});
            }, 10000);
        }
       
    }

    function createMap(mapboxAccessToken, options) {
        const tileOptions = {
            accessToken: mapboxAccessToken,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            id: 'mapbox.streets'
        };
        map = L.map('map', options);

        L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', tileOptions).addTo(map);

        map.on('locationfound', onLocationFound);
        map.on('locationerror', onLocationError);
        locate();
    }

    function loadRoute(route) {
        const proxyurl = "https://cors-anywhere.herokuapp.com/";
        const url = "https://ersur.org/muni/data.php?command=stops&route=";
        clearInterval(timer);
        $.ajax({
            url: proxyurl + url + route,
            success: function(response) {
                clearMarkers(stopMarkers);
                stopMarkers = response.map(function(stop) {
                    return stopMarker(stop);
                });
            }
        });

        updateVehicles(route);
        timer = window.setInterval(function() {
            updateVehicles(route);
        }, 8000);
    }

    $(document).ready(function(){
        const $routes = $('#routes');
        const initialLocation = [37.74, -122.4498];
        const mapboxAccessToken = 'pk.eyJ1IjoiYW1hcmtvc2lhbiIsImEiOiJXLUl2ZFhvIn0.6Z6e04EG9v5Y0LSnXnJz-g';
        const mapOptions = {
            center: initialLocation,
            dragging: true,
            maxZoom: 18,
            minZoom: 12,
            preferCanvas: true,
            zoom: 12.1,
            zoomDelta: 0.5,
            zoomSnap: 0.25
        };

        const root = '/muni';
        const useHash = true;
        const hash ='#';
        const router = new Navigo(root, useHash, hash);

        createMap(mapboxAccessToken, mapOptions);

        const proxyurl = "https://cors-anywhere.herokuapp.com/";
        const url = "https://ersur.org/muni/data.php?command=routes";
        $.ajax({
            url: proxyurl + url,
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