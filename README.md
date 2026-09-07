# Kitesurf .fit File Data Session Analytics 

A web dashboard for exploring a sport `.fit` formated file data export. This app is specifically tailored to analyse kite surf sessions. It was designed and tested with Suunto `.fit` generated data, but generally works with any `.fit` compatible files from other manufacturers like Garmin, etc.

### Overview

![Overview showing a synthetic kite session](docs/overview-demo.png)

Shows the sessions training load metrics and health sensor data visualizations like speed and heart rate as well as the track location on static map.

### Session overview

![Session overview showing synthetic wind and technique data](docs/session-overview-demo.png)

Highligthed session events and wind data annotation.

![Session overview showing a linked graph and map selection](docs/session-overview-interaction-demo.png)

Analyze sensor data linked to every geographic location on the map at any point in time.

### Ride segments

![Ride segments](docs/ride-segments-demo.png)

Automatically detected session segments along the recorded track with statistic for each split.

## Privacy

- Your selected .FIT file is decoded, analysed and rendered in the your local browser only.
- The .FIT file and derived activity data are held only in the current page's memory. The app does not write them to local storage, IndexedDB, cookies, or an account. Reloading or closing the tab clears the current activity.
- When a GPS track is visible, your browser requests the required OpenStreetMap tiles based on track GPS location.
- Wind data is loaded from OpenMeteo using the GPS coordinates and the session's UTC start/end timestamps.

## Run

Install Node.js 18 or newer, then run:

```bash
npm run app
```

Open <http://127.0.0.1:4173>. Use **Choose FIT file** or drag a file into the panel. To use another port:

```bash
npm run app -- --port 4174
```

The decoder validates FIT header and file CRCs, understands standard FIT definitions, compressed timestamps, FIT scaling, GPS/speed/heart-rate fields, standard weather conditions, and Suunto developer-field descriptions. The overview draws a downsampled GPS track over OpenStreetMap tiles and expands compact message sections with representative field values while leaving time-series values out. Unknown messages and fields remain in the parsed activity model so records, route, and sport-specific pages can be added without changing the import flow.
