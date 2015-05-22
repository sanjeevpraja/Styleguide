var express = require('express');
var request = require('request');
var jf = require('jsonfile');
var fs = require('fs');
var config = require('../config.json');

var router = express.Router();

router.get('/snippets', function (req, res, next) {

  var requestPages = function(urls, callback) {
    var results = {},
        t = urls.length,
        c = 0,
        handler = function(error, response, body) {
          var url = response.request.uri.href;
          results[url] = {
            error: error,
            response: response,
            body: body
          };
          if (++c === urls.length) {
            callback(results);
          }
        };
        while (t--) {
            request(urls[t], handler);
        }
  };

  var findSnippet = function(snippetId, callback) {
    for (var i = 0, length = config.categories.length; i < length; i++) {
      var dataPath = './db/' + config.categories[i].name + '.json';
      var snippets = jf.readFileSync(dataPath, {throws: false}) || [];

      var desireableSnippet = snippets.filter(function (obj) {
        if (obj.id == snippetId) {
          return obj
        }
      })[0];

      if (desireableSnippet) {
        callback({ snippet: desireableSnippet, category: i });
      } 
    }
  }

  requestPages(config.scrapeUrls, function(responses) {
    var filteredHTml = [], results = [];
    var snippetai = {}
    var url, response, uniques = jf.readFileSync('./db/uniques.json', {throws: false}) || [];
    for (url in responses) {
      // reference to the response object
      response = responses[url];
      // find errors
      if (response.error) {
        console.log("Error", url, response.error);
        return;
      }
       // render body
      if (response.body) {
        var filters;
        var htmlBody = response.body;
        filters = htmlBody.match(/<!-- snippet:start [\d\D]*?snippet:end -->/gi);
        filteredHTml = filteredHTml.concat(filters);
      }
    }

    //build snippets
    for (var i = 0, length = filteredHTml.length; i < length; i++) {
      var snippetId, categoryId;
      var domMarker = filteredHTml[i].match(/<!-- snippet:start [\d\D]*? -->/gi)[0];
      var extractedIds = domMarker.match(/[\d]+/g);
      if (extractedIds) {
        snippetId = Number(extractedIds[0]);
        //TODO: instead of 0, find undefined category id
        categoryId = extractedIds[1] ? Number(extractedIds[1]) : 0;
      }

      if (!snippetId) {
        res.status(500).send('Snippet ID is not defined! In: ' + filteredHTml[i]);
        return;
      }

      var newSnippet = {
        id: snippetId,
        name: "",
        code: filteredHTml[i],
        description: "",
        inlineCss: "",
        isEdited: false,
        isDeleted: false
      }

      snippetai[categoryId] = snippetai[categoryId] ? snippetai[categoryId].concat(newSnippet) : [newSnippet];
      results.push(newSnippet);
    }

    for (category in snippetai) {

      var currentDataPath;

      for (var i = 0, length = config.categories.length; i < length; i++) {
        if (config.categories[i].id == category) {
          currentDataPath = './db/' + config.categories[i].name + '.json';
          break;
        }
      }

     if (!currentDataPath) {
      res.json('Category with id: ' + catId + 'not found.');
      return;
    }

      var current = jf.readFileSync(currentDataPath, {throws: false}) || [];

      for (var i = 0, snipp = snippetai[category], length = snipp.length; i < length; i++) {

        if (uniques.indexOf(snipp[i].id) == -1) {
          uniques.push(snipp[i].id);
          current = current.concat(snipp[i]);
        } else {
          findSnippet(snipp[i].id, function(snippAndCat) {
            if (!snippAndCat.snippet.isEdited) {
              var index;
              if (snippAndCat.category == category) {
                for(var j = 0, len = current.length; j < len; j++) {
                  if (current[j].id === snippAndCat.snippet.id) {
                    index = j;
                    break;
                  }
                }

                current.splice(index, 1);
                current.push(snipp[i]);
              } else {
                var oldCatPath;

                for (var j = 0, length = config.categories.length; j < length; j++) {
                  if (config.categories[i].id == snippAndCat.category) {
                    oldCatPath = './db/' + config.categories[i].name + '.json';
                    break;
                  }
                }

                if (!oldCatPath) {
                  res.json('Category with id: ' + catId + 'not found.');
                  return;
                }

                var snippets = jf.readFileSync(oldCatPath, {throws: false}) || [];

                for(var j = 0, len = snippets.length; j < len; j++) {
                  if (snippets[j].id === snippAndCat.snippet.id) {
                    index = j;
                    break;
                  }
                }

                snippets.splice(index, 1);

                jf.writeFileSync(oldCatPath, snippets);

                current.push(snipp[i]);
              }
            } else {
              console.log('snippet was edited');
            }
          });

        }
      }

      jf.writeFileSync(currentDataPath, current);
    }

    jf.writeFileSync('./db/uniques.json', uniques);

    res.json(snippetai);
  });

});

router.get('/sass', function (req, res) {
  var sass;
  var typography = [], colors = [];
  for (var i = 0, length = config.sassResources.length; i < length; i++) {
    var typo, col, weig, colorValues, unassigned = [], assigned = {};
    sass = fs.readFileSync(config.sassResources[i], {encoding: 'utf-8'});


    typo = sass.match(/\/\/-- typo:start[\d\D]*?typo:end --\/\//gi);
    var array = typo[0].split('\n');
    array.splice(0,1);
    array.pop();

    //Constructing types array
    for (var j = 0, len = array.length; j <len; j++) {
      var variableName = array[j].match(/\$[\d\D]*?(?=:)/gi)[0];
      var value = array[j].match(/(?=:)[\d\D]*?(?=;)/)[0];
      value = value.substring(1, value.length).trim();

      var weights = array[j].match(/\([\d\D]*?(?=\))/gi)[0];
      weights = weights.substring(1, weights.length);

      weights = weights.replace(/ /g,'').split(',');

      weights = weights.map(function (weight) {
        return Number(weight);
      });

      var type = {
        variable: variableName,
        value: value,
        weights: weights.sort()
      }

      typography.push(type);
    }


    col = sass.match(/\/\/-- colors:start[\d\D]*?colors:end --\/\//gi);

    for (var j = 0, len = col.length; j < len; j++) {
      colorValues = col[j].split('\n');

      //remove dom markers
      colorValues.shift();
      colorValues.pop();

      unassigned = unassigned.concat(colorValues);
    }

    //prepare array structure
    for (var j = 0, len = unassigned.length; j < len; j++) {
      var variableName = unassigned[j].match(/\$[\d\D]*?(?=:)/gi)[0];
      var value = unassigned[j].match(/\:[\d\D]*?(?=;)/gi)[0];

      value = value.substring(1, value.length).trim();

      unassigned[j] = {variable: variableName, value: value}
    }

    weig = sass.match(/\([\d\D]*?\)/gi);
  }

  jf.writeFileSync('./db/sassdata.json', typography);

  res.json(typography);
});

module.exports = router;