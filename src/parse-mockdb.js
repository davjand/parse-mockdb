var _ = require('lodash'),
  sinon = require('sinon'),
  Parse = require('parse'),
  db = {};

if (typeof Parse.Parse != 'undefined') {
  Parse = Parse.Parse;
}

function mockDB() {
  mockRequests();
  var realSave = Parse.Object.prototype.save;
  sinon.stub(Parse.Object.prototype, "save", function() {
    var options = this;
    return realSave.call(this).then(function(savedObj) {
      // save to our local db
      db[options.className] = db[options.className] || [];
      db[options.className].push(storableFormat(savedObj, options.className));
      return savedObj;
    });
  });
}

function storableFormat(object, className) {
  var storableData = {
    id: object.id,
    createdAt: object.createdAt.toJSON(),
    updatedAt: object.updatedAt.toJSON(),
    className: className,
  };
  _.each(object.attributes, function(v, k) {
    if (v.id) {
      storableData[k] = {
        __type: "Pointer",
        objectId: v.id,
        className: v.className
      };
    } else {
      storableData[k] = v;
    }
  });

  return storableData;
}

function matchesAfterIncluding(matches, includeClause) {
  if (!includeClause) {
    return matches;
  }

  includeClauses = includeClause.split(",");
  matches = _.map(matches, function(match) {
    for (var i = 0; i < includeClauses.length; i++) {
      var paths = includeClauses[i].split(".");
      match = objectAfterReplacingAtIncludePaths(match, paths);
    }
    return match;
  });

  return matches;
}

function objectAfterReplacingAtIncludePaths(object, paths) {
  if (paths.length != 0) {
    var path = paths.shift();
    if (!object[path]) {
      return object;
    }

    var obj = objectForPath(object[path]);
    object[path] = objectAfterReplacingAtIncludePaths(obj, paths);
  }
  return object
};

function objectForPath(objectOrPointer) {
  var className, objectId;
  if (objectOrPointer.__type == "Object") {
    // fully formed, no need to look up
    return objectOrPointer;
  } else if (objectOrPointer.id && objectOrPointer.className) {
    objectId = objectOrPointer.id;
    className = objectOrPointer.className;
  } else {
    className = objectOrPointer["className"];
    objectId = objectOrPointer["objectId"];
  }
  var storedItem = _.find(db[className], function(obj) { return obj.id == objectId; });
  if (storedItem) {
    storedItem.__type = "Object";
  }
  return storedItem;
}

function queryFilter(whereClause) {
  return function(object) {
    return _.reduce(whereClause, function(result, n, key) {
      var whereParams = whereClause[key];
      var match;
      if (typeof whereParams == "object" && whereParams) {
        if (whereParams["$in"]) {
          // containedIn
          match = _.find(whereParams["$in"], function(target) {
            return evaluateMatch(target, object[key]);
          });
        } else if (whereParams["__type"] == "Pointer") {
          // match on an object
          var storedItem = objectForPath(whereParams);
          match = object[key] && (object[key].id == storedItem.objectId);
        } else {
          console.trace();
          throw new Error("Parse-Mock: unknown query where clause: " + JSON.stringify(whereParams));
        }
      } else if (whereParams) {
        // simple match
        match = object[key] == whereParams;
      } else {
        match = true
      }
      return result && match;
    }, true);
  };
}

function evaluateMatch(obj1, obj2) {
  if (obj1 == undefined || obj2 == undefined) {
    return false;
  }

  // scalar values
  if (obj1 == obj2) {
    return true;
  }

  // both pointers
  if (obj1.objectId !== undefined && obj1.objectId == obj2.objectId) {
    return true;
  }

  // both objects
  if (obj1.id !== undefined && obj1.id == obj2.id) {
    return true;
  }

  // one pointer, one object
  if (obj1.id !== undefined && obj1.id == obj2.objectId) {
    return true;
  } else if (obj2.id !== undefined && obj2.id == obj1.objectId) {
    return true;
  }

  return false;
}

function cleanUp() {
  db = {};
  Parse.Object.prototype.save.restore();
  Parse._request.restore();
}

function mockRequests() {
  sinon.stub(Parse, '_request', function(options) {
    var response, status, xhr;
    switch (options.method) {
    case "GET":
      response = stubGetRequest(options);
      status = "200";
      break;
    case "POST":
      response = stubPostRequest(options);
      status = "201";
      break;
    case "PUT":
      response = stubPostRequest(options);
      status = "200";
      break;
    default:
      throw new Error("unknown request type");
    }

    xhr = {}; // TODO
    return Parse.Promise.when([response, status, xhr]);
  });
}

function stubGetRequest(options) {
  var classMatches = _.cloneDeep(db[options.className]);
  var matches = _.filter(classMatches, queryFilter(options.data.where));
  matches = matchesAfterIncluding(matches, options.data.include);
  ret = { "results": matches };
  return ret;
}

function stubPostRequest(options) {
  if (options.objectId) {
    var data = {};//options.data;
    data.updatedAt = (new Date()).toJSON();
    return Parse.Promise.as(data);
  }

  var promise = new Parse.Promise.as({
    id:  _.uniqueId(),
    createdAt: (new Date()).toJSON(),
    updatedAt: (new Date()).toJSON()
  });
  return promise;
}

function promiseResultSync(promise) {
  var result;
  promise.then(function(res) {
    result = res;
  });

  return result;
}

function queryToJSON(query) {
  return _.extend(query.toJSON(), {
    className: query.className
  });
}

Parse.MockDB = {
  mockDB: mockDB,
  cleanUp: cleanUp,
  mockRequests: mockRequests,
  promiseResultSync: promiseResultSync,
};

module.exports = Parse.MockDB;
