# signalk-to-mongodb-atlas
SignalK plugin to push deltas to MongoDB Atlas (or any compatible HTTP endpoint)

The plugin is designed for batch writes to a cloud hosted MongoDB Atlas data base. It could also be used to push data to many other online services that provide a https:// endpoint with a simple API key for authentication.

## Data Format 
 
As MongoDB is a document based (noSQL) database, measurements are pushed as simple JSON objects as follows: 
```bash
{
  "source": "NMEA2K.c0a0b40010e111f6",
  "context": "vessels.urn:mrn:imo:mmsi:100000001",
  "path": "environment.wind.speedApparent",
  "value": 0.56,
  "time": {		// eJSON time
    "$date": {
      "$numberLong": "1666287376565"
    }
  },
  "ver": "2",		// any user defined tags are added as properties
  "self": true,		// 'tag as self' flag
  "dt": 1666287376,	// unix date-time in seconds
  "mmsi": 100000001	// vessel mmsi derived from the signalK context
}
```

## Config Parameters

### API Endpoint
the full url to your cloud hosted MongoDB Atlas endpoint
```https://ap-southeast-2.aws.data.mongodb-api.com/app/[your endpoint]```

### API Key
the secret MongoDB Atlas API Key for your cloud hosted database
```some secret key```

### API Http Method
the HTTP method
```GET, PUT, POST```

### Batch Size
the number of values to send in a single batch to the MongoDB Atlas endpoint
```100```

### Flush Interval
maximum time in seconds to keep points in an unflushed batch, 0 means don't periodically flush
```60```

### Maximum Buffer Size
maximum size of the buffer (this is recommended as a multiple of Batch Size to allow for items that may not have been able not be sent the first time)
```1000```

### Maximum Time to Live
maximum time to buffer data in seconds - older data is automatically removed from the buffer (i.e. and not sent)
```180```

### Tag as 'self' if applicable
tag measurements as {self: true} when from vessel.self - requires an MMSI or UUID to be set in the Vessel Base Data on the Server->Settings page
```180```

### Default Tags
default tags added to every measurement
```{name: 'my tag', value: 'true'}```

### Path Options
these options are set per individual path, selected to send data from SignalK to MongoDB Atlas

  #### Enabled?
  enable writes to MongoDB Atlas for this path (server restart is required)
  ```true```

  #### SignalK context
  context to record e.g.'self' for own ship, or 'vessels.*' for all vessels, or '*' for everything
  ```self```

  #### SignalK path
  path to record e.g.'navigation.position' for positions, or 'navigation.*' for all navigation data, or '*' for everything
  ```true```

  #### Recording interval
  minimum milliseconds between data records
  ```1000```

  #### Path tags
  Define any tags to include for this path
  ```{name: 'my path', value: '1234'}```


