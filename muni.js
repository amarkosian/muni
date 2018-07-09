(function($, L){
    var map;
    var stopMarkers = [];
    var vehicleMarkers = [];
    var timer;

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
                iconSize: [5,5],
                iconAnchor: [2,2]
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
            iconSize:     [10, 10],
            iconAnchor:   [5, 5]
        });
        return L.marker([vehicle.location.lat, vehicle.location.lon], {
            icon: marker,
            title: vehicle.id
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
            url: 'http://webservices.nextbus.com/service/publicXMLFeed?command=vehicleLocations&a=sf-muni&t=0&r=' + route,
            success: function(response) {
                clearMarkers(vehicleMarkers);
                vehicleMarkers = getVehicles(response).map(function (vehicle) {
                    return vehicleMarker(vehicle, map);
                });
            }
        });
    }

    function createMap(mapboxAccessToken, options) {

        var tileOptions = {
            accessToken: mapboxAccessToken,
            attribution: 'Map data &copy; <a href="https://www.openstreetmap.org/">OpenStreetMap</a>',
            id: 'mapbox.streets'
        }
        map = L.map('map', options);

        L.tileLayer('https://api.tiles.mapbox.com/v4/{id}/{z}/{x}/{y}.png?access_token={accessToken}', tileOptions).addTo(map);
    }

    function loadRoute(route) {
        clearInterval(timer);
        $.ajax({
            url: 'http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=sf-muni&r=' + route,
            success: function(response) {
                clearMarkers(stopMarkers);
                stopMarkers = parseStops(response).map(function(stop) {
                    return stopMarker(stop);
                });
            }
        });

        updateVehicles(route);
        timer = window.setInterval(function() {
            updateVehicles(route);
        }, 8000);
    }

    function getRouteFromUrl() {
        var parts = window.location.href.split('#/');
        return parts.length === 2 ? parts[1] : null;
    }

    $(document).ready(function(){
        var $routes = $('#routes');
        var initialLocation = [37.76, -122.45];
        var initialRoute = getRouteFromUrl();
        var mapboxAccessToken = 'pk.eyJ1IjoiYW1hcmtvc2lhbiIsImEiOiJXLUl2ZFhvIn0.6Z6e04EG9v5Y0LSnXnJz-g';
        var mapOptions = {
            center: initialLocation,
            dragging: true,
            maxZoom: 18,
            minZoom: 12,
            preferCanvas: true,
            zoom: 12.5,
            zoomDelta: 0.5,
            zoomSnap: 0.25
        };


        createMap(mapboxAccessToken, mapOptions);

        $.ajax({
            url: 'http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=sf-muni',
            success: function(response) {
                var routes = parseRoutes(response);
                var $optgroup = $('<optgroup>');

                routes.forEach(function(route) {
                    $optgroup.append(makeOption(route.title, route.tag));
                });

                $routes.append($optgroup);
            }
        });

        $routes.on('change', function() {
            var route = $(this).val();
            window.location.href = '/muni/#/' + route;
            loadRoute(route);
        });

        if (initialRoute) {
            loadRoute(initialRoute);
        }
    });
})(jQuery, L);