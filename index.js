const express = require('express');
const app = express();
const bodyParser = require('body-parser');
var expressBatch = require("express-batch");
const csv = require('csvtojson');
const alasql = require('alasql');
const Moment = require('moment');
const MomentRange = require('moment-range');
const moment = MomentRange.extendMoment(Moment);
const csv_out = require('express-csv');

alasql.fn.moment = moment;

/**
 * Wrapper method to convert CSV into JSON and format dates
 * @param filename
 * @returns {Promise}
 */
const csv2json = (data) => {
  return new Promise((success, reject) => {
    let csv_data = [];
    // Transform CSV into JSON
    csv()
      .fromString(data)
      .on('json',(jsonObj)=>{
        csv_data.push({
          user_id: jsonObj.user_id,
          time: moment(Number(jsonObj.time)).format('MM/DD/YYYY') // Set it to the beginning of the day
        });
      })
      .on('done',(error)=>{
        if(error) {
          reject(error);
        } else {
          console.log(csv_data);
          success(csv_data);
        }
      })
  });
};

/**
 * Recursive method to extract cohorts
 * @param weeks
 * @param cohorts
 */
const extract_cohorts = (weeks, data, cohorts, cohort_id) => {
  if(weeks.length === 0) return cohorts;

  // Extract the cohort unique IDs from week 0
  const result = alasql('SELECT DISTINCT user_id from ? WHERE time BETWEEN "'+ weeks[0] +'" AND "'+ weeks[1] +'" GROUP BY user_id ORDER BY time ASC', [data]);
  const unique_ids = result.map(obj => {
    return obj.user_id;
  });

  cohorts[cohort_id] = [];
  cohorts[cohort_id].push({week: weeks[0], count: unique_ids.length});

  weeks.splice(0, 1); // Delete the first week

  for(let [index, week] of weeks.entries()) {
    if (weeks[index + 1] === undefined) continue;

    const query_res = alasql('SELECT DISTINCT user_id from ? WHERE user_id IN ("'+(unique_ids.join('" , "'))+'") AND time BETWEEN "'+ weeks[index] +'" AND "'+ weeks[index + 1] +'" GROUP BY user_id ORDER BY time ASC', [data]);

    const ids = query_res.map(obj => {
      return obj.user_id;
    });

    cohorts[cohort_id].push({week: weeks[index + 1], count: ids.length});
  }
  extract_cohorts(weeks, data, cohorts, ++cohort_id);
};

// Body parser configuration
app.use(bodyParser.json({limit: '50mb'}));
app.use(bodyParser.urlencoded({limit: '50mb', extended: true}));

// Add headers
app.use((req, res, next) => {
      // Website you wish to allow to connect
      res.setHeader('Access-Control-Allow-Origin', '*');
      // Request methods you wish to allow
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS, PUT, PATCH, DELETE');
      // Request headers you wish to allow
      res.setHeader('Access-Control-Allow-Headers', 'X-Requested-With,content-type');
      // Set to true if you need the website to include cookies in the requests sent
      // to the API (e.g. in case you use sessions)
      res.setHeader('Access-Control-Allow-Credentials', true);
      // Pass to next layer of middleware
      next();
  });

// Initial API Endpoint
app.get('/', (req, res) => {
  res.json({ api: 'V1.0', description: 'Cohorts API'});
});

app.use("/batch", expressBatch(app));


app.post('/cohort', (req, res) => {
  const body =  req.body;
  csv2json(body.data)
    .then((data) => {
      // Order the response by the date from older to newer
      const minDate = alasql('select time from ? order by time ASC limit 1', [data]);
      const maxDate = alasql('select time from ? order by time DESC limit 1', [data]);
      const range = moment.range(moment(minDate[0].time).day("Monday"), moment(maxDate[0].time).day("Monday")); 
      let weeks = [];   
      for (let month of range.by('week')) {
          weeks.push(month.format('MM/DD/YYYY'));
      }
      const cohorts = [];
      extract_cohorts(weeks, data, cohorts, 0);

      const final_cohorts = [];
      for(let cohort of cohorts) {
        let index_cohort = cohort[0].week;
        for(let cohort_data of cohort.entries()) {
          final_cohorts.push({'cohort_week': index_cohort, 'activity_week': cohort_data[1].week, 'users': cohort_data[1].count , 'revenue': 0});
        }
      }
      res.send(final_cohorts);
    })
    .catch((error) => {
      res.status(500).send('Something broke!');
    })
});

app.listen(process.env.PORT || 3000, ()=> {
  console.log('Example app listening on port 3000!');
});
