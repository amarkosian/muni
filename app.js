var MuniApp;
var user = null;

(function() {
    "use strict";
    MuniApp = function() {
        var self = this;
        this.Route = Backbone.Model.extend({
            defaults: {
                tag: '',
                title: ''
            }
        });
        this.RouteList = Backbone.Collection.extend({
            model: this.Route,
            url: 'http://webservices.nextbus.com/service/publicXMLFeed?command=routeList&a=sf-muni',
            parse: self.xml.parse.routes,
            fetch: self.xml.fetch
        });
        this.RouteListView = Backbone.View.extend({
            template: Handlebars.compile(
                    '<option></option>' +
                    '{{#each models}}' +
                    '<option value="{{attributes.id}}">{{attributes.title}}</option>' +
                    '{{/each}}'
                    ),
            render: function() {
                $('#route-select').html(this.template(this.collection));
                return this;
            }
        });

        this.Stop = Backbone.Model.extend({
            defaults: {
                tag: '',
                title: ''
            }
        });
        this.StopList = Backbone.Collection.extend({
            model: this.Stop,
            url: function() {
                return 'http://webservices.nextbus.com/service/publicXMLFeed?command=routeConfig&a=sf-muni&r=' + $('#route-select').val();
            },
            parse: self.xml.parse.stops,
            fetch: self.xml.fetch,
            direction: function() {
                return $('#direction-select').val();
            }
        });
        this.StopListView = Backbone.View.extend({
            template: Handlebars.compile(
                    '<option></option>' +
                    '{{#each models}}' +
                    '<option value="{{attributes.id}}">{{attributes.title}}</option>' +
                    '{{/each}}'
                    ),
            render: function() {
                $('#stop-select').html(this.template(this.collection));
                return this;
            }
        });

        this.Prediction = Backbone.Model.extend({
            defaults: {
            }
        });
        this.PredictionList = Backbone.Collection.extend({
            model: this.Prediction,
            url: function() {
                var route = $('#route-select').val();
                var stop = $('#stop-select').val();
                return 'http://webservices.nextbus.com/service/publicXMLFeed?command=predictions&a=sf-muni&r=' + route + '&s=' + stop + '&useShortTitles=true';
            },
            parse: self.xml.parse.predictions,
            fetch: self.xml.fetch
        });
        this.PredictionListView = Backbone.View.extend({
            template: Handlebars.compile(
                    '{{#each models}}' +
                    '<li>{{attributes.prediction.minutes}} minutes {{attributes.prediction.seconds}} seconds</li>' +
                    '{{/each}}'
                    ),
            render: function() {
                $('#prediction-list').html(this.template(this.collection));
                return this;
            }
        });

        return this;
    };

    MuniApp.prototype.xml = {
        fetch: function(options) {
            var options = options || {};
            options.dataType = "xml";
            return Backbone.Collection.prototype.fetch.call(this, options);
        },
        parse: {
            routes: function(response) {
                var routes = [];
                $(response).find('route').each(function(index, elem) {
                    routes.push({
                        id: $(elem).attr('tag'),
                        tag: $(elem).attr('tag'),
                        title: $(elem).attr('title')
                    });
                });
                return routes;
            },
            stops: function(response) {
                var stops = [];
                var validStops = [];
                var direction = $('#direction-select').val();

                $(response).find('direction').each(function(index, element) {
                    if ($(element).attr('name') === direction) {
                        $(element).find('stop').each(function(index, elem) {
                            validStops.push($(elem).attr('tag'));
                        });
                    }
                });

                $(response).find('stop').each(function(index, elem) {
                    var $el = $(elem);

                    if (typeof $el.attr('stopId') !== 'undefined' && validStops.indexOf($el.attr('tag')) > -1) {
                        stops.push({
                            id: $el.attr('tag'),
                            tag: $el.attr('tag'),
                            title: $el.attr('title'),
                            lat: $el.attr('lat'),
                            lon: $el.attr('lon'),
                            stopId: $el.attr('stopId')
                        });
                    }
                });
                return stops;
            },
            predictions: function(response) {
                var $xml = $(response);
                var predictions = [];
                $xml.find('prediction').each(function(index, elem) {
                    var prediction = elem.attributes;
                    var seconds = parseInt(prediction[1].value, 10);
                    predictions.push({
                        epochtime: prediction[0].value,
                        seconds: seconds,
                        minutes: (seconds / 60).toFixed(1),
                        prediction: {
                            minutes: Math.floor(seconds / 60), seconds: seconds % 60},
                        isdeparture: prediction[3].value,
                        affectedbylayover: prediction[4].value,
                        dirtag: prediction[5].value,
                        vehicle: prediction[6].value,
                        block: prediction[7].value,
                        triptag: typeof prediction[8] !== 'undefined' ? prediction[8].value : ''});
                });
                return predictions;
            }
        }
    };
})();

$(document).ready(function() {
    var muni = new MuniApp();
    var routeList = new muni.RouteList();
    var routeListView = new muni.RouteListView({collection: routeList});

    var stopList = new muni.StopList();
    var stopListView = new muni.StopListView({collection: stopList});

    var predictionList = new muni.PredictionList();
    var predictionListView = new muni.PredictionListView({collection: predictionList});

    routeList.on('reset', function() {
        routeListView.render();
    });
    stopList.on('reset', function() {
        stopListView.render();
    });
    predictionList.on('reset', function() {
        predictionListView.render();
    });

    $('#route-select').on('change', function() {
        stopList.fetch({reset: true});
    });
    $('#direction-select').on('change', function() {
        if (!$('#stop-select').val()) {
            stopList.fetch({reset: true});
        }
        else {
            predictionList.fetch({reset: true});
        }
    });
    $('#stop-select').on('change', function() {
        predictionList.fetch({reset: true});
    });

    $('#refresh').on('click', function() {
        if ($('#route-select').val() && $('#direction-select').val() && $('#stop-select').val()) {
            predictionList.fetch({reset: true});
        }
    });

    routeList.fetch({reset: true});
});