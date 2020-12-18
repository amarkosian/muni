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
    const icon = vehicle.dirTag === 'I' ? 'inbound.png' : 'outbound.png';
    const marker = L.icon({
      iconUrl: icon,
      iconSize:     [15,15],
      iconAnchor:   [7,7]
    });
    return L.marker([vehicle.location.lat, vehicle.location.lon], {
      icon: marker,
      title: vehicle.id,
      zIndexOffset: 1000
    }).bindPopup(vehiclePopup(vehicle)).addTo(map);
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
    clearInterval(timer);
    $.ajax({
      url: 'data.php?command=stops&route=' + route,
      success: function(response) {
        clearMarkers(stopMarkers);
        stopMarkers = response.map(function(stop) {
          return stopMarker(stop);
        });
        document.title = route + " :: muni";
      }
    });

    updateVehicles(route);
    timer = window.setInterval(function() {
      updateVehicles(route);
    }, 9000);
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