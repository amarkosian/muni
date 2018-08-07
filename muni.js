(function($, L, Navigo){
    var map;
    var stopMarkers = [];
    var vehicleMarkers = [];
    var timer;
    var youAreHere = null;

    function parseRoutes(response) {
        return $(response).find('route').map(function () {
            var $elem = $(this);
            return {
                id: $elem.attr('tag'),
                tag: $elem.attr('tag'),
                title: $elem.attr('title')
            };
        }).toArray();
    }

    function parseStops(response) {
        var stops = [];
        var validStops = [];
        var $xml = $(response);

        $xml.find('direction').each(function() {
            var $direction = $(this);

            $direction.find('stop').each(function() {
                validStops.push($(this).attr('tag'));
            });
        });

        $xml.find('stop').each(function() {
            var $elem = $(this);

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

    function getDirection(dirTag) {
        var _dirTag = dirTag || '';
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
            +  '<div><strong>Direction: </strong>' + (vehicle.dirTag === 'I' ? 'Inbound' : 'Outbound') + '</div>'
            +  '<div><strong>Heading: </strong>' + vehicle.heading + '</div>'
            +  '<div><strong>Speed: </strong>' + vehicle.speedkmhr + '</div>';
    }

    function vehicleMarker(vehicle) {
        var icon = vehicle.dirTag === 'I' ? 'inbound.png' : 'outbound.png';
        var marker = L.icon({
            iconUrl: icon,
            iconSize:     [15,15],
            iconAnchor:   [7,7]
        });
        return L.marker([vehicle.location.lat, vehicle.location.lon], {
            icon: marker,
            title: vehicle.id,
            zIndexOffset: 1000
        }).bindPopup(vehiclePopup(vehicle), {id: 1234}).addTo(map);
    }

    function getVehicles(response) {
        var $xml = $(response);
        return $xml.find('vehicle').map(function() {
            var $this = $(this);
            var directionTag = $this.attr('dirTag') || '';
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
        $.ajax({
            url: 'data.php?command=vehicles&route=' + route,
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
        var radius = e.accuracy;
        //L.marker(e.latlng).addTo(map).bindPopup("You are within " + radius + " meters from this point");

        if (youAreHere !== null) {
            map.removeLayer(youAreHere);
        }

        youAreHere = L.circle(e.latlng, {radius: radius, fill: true, fillOpacity: 0.75});
        youAreHere.addTo(map);
    }

    function onLocationError(e) {
        alert(e.message);
    }

    function createMap(mapboxAccessToken, options) {
        var tileOptions = {
            accessToken: mapboxAccessToken,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            id: 'mapbox.streets'
        }
        map = L.map('map', options);

        L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', tileOptions).addTo(map);

        map.on('locationfound', onLocationFound);
        map.on('locationerror', onLocationError);
        map.locate({setView : true, maxZoom: 14});
        window.setInterval(function() {
            map.locate({setView : false});
        }, 10000);
    }

    function loadRoute(route) {
        clearInterval(timer);
        $.ajax({
            url: 'data.php?command=stops&route=' + route,
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
        }, 9000);
    }

    function getRouteFromUrl() {
        var parts = window.location.href.split('#/');
        return parts.length === 2 ? parts[1] : null;
    }

    $(document).ready(function(){
        var $routes = $('#routes');
        var initialLocation = [37.74, -122.4498];
        var mapboxAccessToken = 'pk.eyJ1IjoiYW1hcmtvc2lhbiIsImEiOiJXLUl2ZFhvIn0.6Z6e04EG9v5Y0LSnXnJz-g';
        var mapOptions = {
            center: initialLocation,
            dragging: true,
            maxZoom: 18,
            minZoom: 12,
            preferCanvas: true,
            zoom: 12.1,
            zoomDelta: 0.5,
            zoomSnap: 0.25
        };

        var root = '/muni';
        var useHash = true;
        var hash ='#';
        var router = new Navigo(root, useHash, hash);

        createMap(mapboxAccessToken, mapOptions);

        $.ajax({
            url: 'data.php?command=routes',
            success: function(response) {
                var routes = parseRoutes(response);
                var $optgroup = $('<optgroup>');

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
            var route = params.route.toUpperCase();
            loadRoute(route);
            $routes.val(route);
        }).resolve();
        
    });
})(jQuery, L, Navigo);