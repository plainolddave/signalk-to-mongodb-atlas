// Filename:    signalk-to-mongodb-atlas
//
// Description: The plugin is designed to do batch writes to a cloud hosted MongoDb Atlas
//              data base. If the connection to MongoDb Atlas is temporarily interrupted the
//              batch of metrics is temporarily buffered for a short time.
//
// Repository:  https://github.com/plainolddave/signalk-to-mongodb-atlas/
//
// Updated:     October 2022
//

const { MongoDb } = require('./mongodb');

module.exports = function (app) {

    var plugin = {};
    var app = app;
    var options = null;
    var mongodb = null;
    var unsubscribes = [];
    let selfContext;

    let getSelfContext = function () {

        // get the current 'vessel.self' context - this seems unnecessarily difficult due to 
        // limitations in the signalK network and may cause inconsistant results depending on 
        // whether UUID or MMSI is defined in the Vessel Base Data on the Server -> Settings page
        const selfUuid = app.getSelfPath('uuid');
        const selfMmsi = app.getSelfPath('mmsi');

        if (selfUuid != null) { // not null or undefined value
            return "vessels." + selfUuid;
        } else if (selfMmsi != null) {
            return "vessels.urn:mrn:imo:mmsi:" + selfMmsi.toString();
        }
        return null;
    };

    plugin.handleUpdates = function (delta, pathOption) {

        // iterate through each update received from the subscription manager
        delta.updates.forEach(update => {

            //if no u.values then return as there are no values to display
            if (!update.values) {
                return
            }

            // iterate through each value received in the update, and send it to MongoDb 
            update.values.forEach(val => {
                try {
                    // create a payload
                    let payload = {
                        'source': update["$source"],
                        'context': delta.context,
                        'path': val.path,
                        'value': val.value,
                        'time': update.timestamp
                    };

                    // add the global tags (if any)
                    options.defaultTags.forEach(tag => {
                        payload[tag.name] = tag.value;
                    });

                    // add path specific tags (if any)
                    pathOption.pathTags.forEach(tag => {
                        payload[tag.name] = tag.value;
                    });

                    // Add a tag {self: true} when the measurement originates from this vessel -
                    // this is reliant on an MMSI or UUID to be set in the Vessel Base Data on 
                    // the Server -> Settings page. Potentially it may be inconsistant depending 
                    // on what UUID / MMSI is set so can be turned off on the plugin settings page, 
                    // and manually added as a tag for individual path(s) if needed
                    if (options.tagAsSelf === true && delta.context.localeCompare(selfContext) === 0) {
                        payload["self"] = true;
                    }

                    // send
                    mongodb.send(payload);

                } catch (error) {
                    app.error(`skipping update: ${JSON.stringify(val)} error: ${JSON.stringify(error)}`);
                }
            });
        });
    };

    plugin.start = function (opts, restart) {

        app.error("plugin started");
        options = opts;
        selfContext = getSelfContext();
        mongodb = new MongoDb(app);
        mongodb.start(options);

        // add subscriptions to signalK updates - note the subscription is created
        // individually per path, as there may be different paremeters set for the context
        options.pathArray.forEach(pathOption => {

            // its useful to be able to turn paths on or off, when trying out options for setup of MongoDB
            if (pathOption.enabled === true) {

                // create a subsciption definition
                localSubscription = {
                    "context": pathOption.context,
                    "subscribe": [{
                        "path": pathOption.path,
                        "policy": "instant",
                        "minPeriod": pathOption.interval
                    }]
                };

                // subscribe to updates for the context and path
                app.subscriptionmanager.subscribe(
                    localSubscription,
                    unsubscribes,
                    subscriptionError => {
                        app.error('error: ' + subscriptionError);
                    },
                    delta => {
                        // add a handler for this update
                        // app.debug(`Received delta: ${JSON.stringify(delta)}`);
                        this.handleUpdates(delta, pathOption);
                    }
                );
                app.debug(`added subscription to: ${JSON.stringify(localSubscription)}`);
            } else {
                app.error(`skipping subscription to: ${pathOption.context}/.../${pathOption.path}`);
            }
        });
    };

    plugin.stop = function () {
        unsubscribes.forEach(f => f());
        unsubscribes = [];
        mongodb.stop();
        app.debug('plugin stopped');
    };

    plugin.id = 'signalk-to-mongodb-atlas';
    plugin.name = 'SignalK to MongoDB Atlas';
    plugin.description = 'Signalk plugin to send data to mongoDB Atlas';
    plugin.schema = {
        "type": "object",
        "description": "This plugin sends data to a MongoDB Atlas database (note: a server restart is needed for updated settings to take effect)",
        "required": [
            "apiUrl",
            "apiKey",
            "apiMethod",
            "batchSize",
            "flushSecs",
            "maxBuffer",
            "ttlSecs",
            "tagAsSelf"
        ],
        "properties": {
            "apiUrl": {
                "type": "string",
                "title": "MongoDB Atlas URL",
                "description": "the url to your cloud hosted MongoDB Atlas endpoint"
            },
            "apiKey": {
                "type": "string",
                "title": "MongoDB Atlas API Key",
                "description": "the api key for your cloud hosted MongoDB Atlas endpoint"
            },
            "apiMethod": {
                "type": "string",
                "title": "Http Method ",
                "description": "GET, PUT, POST etc..."
            },
            "batchSize": {
                "type": "number",
                "title": "Batch Size",
                "description": "the number of values to send in a single batch to the MongoDB Atlas endpoint",
                "default": 100
            },
            "flushSecs": {
                "type": "number",
                "title": "Flush Interval",
                "description": "maximum time in seconds to keep points in an unflushed batch, 0 means don't periodically flush",
                "default": 60
            },
            "maxBuffer": {
                "type": "number",
                "title": "Maximum Buffer Size",
                "description": "maximum size of the buffer - it contains items that could not be sent for the first time",
                "default": 1000
            },
            "ttlSecs": {
                "type": "number",
                "title": "Maximum Time to Live",
                "description": "maximum time to buffer data in seconds - older data is automatically removed from the buffer (i.e. and not sent)",
                "default": 180
            },
            "tagAsSelf": {
                "type": "boolean",
                "title": "Tag as 'self' if applicable",
                "description": "tag measurements as {self: true} when from vessel.self - requires an MMSI or UUID to be set in the Vessel Base Data on the Server->Settings page",
                "default": true
            },
            "defaultTags": {
                "type": "array",
                "title": "Default Tags",
                "description": "default tags added to every measurement",
                "default": [],
                "items": {
                    "type": "object",
                    "required": [
                        "name",
                        "value"
                    ],
                    "properties": {
                        "name": {
                            "type": "string",
                            "title": "Tag Name"
                        },
                        "value": {
                            "type": "string",
                            "title": "Tag Value"
                        }
                    }
                }
            },
            "pathArray": {
                "type": "array",
                "title": "Paths",
                "default": [],
                "items": {
                    "type": "object",
                    "required": [
                        "context",
                        "path",
                        "interval"
                    ],
                    "properties": {
                        "enabled": {
                            "type": "boolean",
                            "title": "Enabled?",
                            "description": "enable writes to MongoDB Atlas for this path (server restart is required)",
                            "default": true
                        },
                        "context": {
                            "type": "string",
                            "title": "SignalK context",
                            "description": "context to record e.g.'self' for own ship, or 'vessels.*' for all vessels, or '*' for everything",
                            "default": "self"
                        },
                        "path": {
                            "type": "string",
                            "title": "SignalK path",
                            "description": "path to record e.g.'navigation.position' for positions, or 'navigation.*' for all navigation data, or '*' for everything",
                        },
                        "interval": {
                            "type": "number",
                            "description": "minimum milliseconds between data records",
                            "title": "Recording interval",
                            "default": 1000
                        },
                        "pathTags": {
                            "title": "Path tags",
                            "type": "array",
                            "description": "Define any tags to include for this path:",
                            "default": [],
                            "items": {
                                "type": "object",
                                "required": [
                                    "name",
                                    "value"
                                ],
                                "properties": {
                                    "name": {
                                        "type": "string",
                                        "title": "Tag Name"
                                    },
                                    "value": {
                                        "type": "string",
                                        "title": "Tag Value"
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    };
    return plugin;
}