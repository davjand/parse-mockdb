var _ = require('lodash'),
  sinon = require('sinon'),
  Parse = require('parse'),
  db = {};

if (typeof Parse.Parse != 'undefined') {
  Parse = Parse.Parse;
}

/**
 * Mocks a Parse API server, by intercepting requests and storing data locally
 * in an in-memory DB.
 */
function mockDB() {
  stubRequests();
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

/**
 * Unstubs Parse SDK requests and clears the local DB.
 */
function cleanUp() {
  db = {};
  Parse.Object.prototype.save.restore();
  Parse._request.restore();
}

/**
 * Intercepts calls to Parse._request, and returns the appropriate
 * successful response based on the request parameters
 */
function stubRequests() {
  sinon.stub(Parse, '_request', function(options) {
    var response, status, xhr;
    switch (options.method) {
    case "GET":
      response = stubGetRequest(options);
      status = "200";
      break;
    case "POST":
      response = stubPostOrPutRequest(options);
      status = "201";
      break;
    case "PUT":
      response = stubPostOrPutRequest(options);
      status = "200";
      break;
    default:
      throw new Error("unknown request type");
    }

    xhr = {}; // TODO
    return Parse.Promise.when([response, status, xhr]);
  });
}

/**
 * Stubs a GET request (Parse.Query.find(), get(), first())
 */
function stubGetRequest(options) {
  var classMatches = _.cloneDeep(db[options.className]);
  var matches = _.filter(classMatches, queryFilter(options.data.where));
  matches = queryMatchesAfterIncluding(matches, options.data.include);
  ret = { "results": matches };
  return ret;
}

/**
 * Stubs a POST or PUT request (Parse.Object.save())
 */
function stubPostOrPutRequest(options) {
  if (options.route == "batch") {
    // batch request. handle them seperately.
    return _.map(options.data.requests, function(request) {
      return { success: { updatedAt: (new Date()).toJSON() } };
    });
  }

  if (options.objectId) {
    return Parse.Promise.as({ updatedAt: (new Date()).toJSON() });
  }

  var promise = new Parse.Promise.as({
    id:  _.uniqueId(),
    createdAt: (new Date()).toJSON(),
    updatedAt: (new Date()).toJSON()
  });
  return promise;
}

/**
 * Simple wrapper around promises known to be executed synchronously
 * useful in test setup for seeding the local DB.
 */
function promiseResultSync(promise) {
  var result;
  promise.then(function(res) {
    result = res;
  });

  return result;
}

/**
 * Converts a fetched Parse object to its JSON format stored in the
 * local DB
 */
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

/**
 * Given a set of matches of a GET query (e.g. find()), returns fully
 * fetched Parse Objects that include the nested objects requested by
 * Parse.Query.include()
 */
function queryMatchesAfterIncluding(matches, includeClause) {
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

/**
 * Recursive function that traverses an include path and replaces pointers
 * with fully fetched objects
 */
function objectAfterReplacingAtIncludePaths(object, paths) {
  if (paths.length != 0) {
    var path = paths.shift();
    if (!object[path]) {
      return object;
    }

    var obj = fetchedObject(object[path]);
    object[path] = objectAfterReplacingAtIncludePaths(obj, paths);
  }
  return object
};

/**
 * Given an object, a pointer, or a JSON representation of a Parse Object,
 * return a fully fetched version of the Object.
 */
function fetchedObject(objectOrPointer) {
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

/**
 * Returns a function that filters query matches on a where clause
 */
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
          var storedItem = fetchedObject(whereParams);
          match = storedItem && object[key] && (object[key].id == storedItem.objectId);
        } else {
          console.trace();
          throw new Error("Parse-MockDB: unknown query where clause: " + JSON.stringify(whereParams));
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

/**
 * Evaluates whether 2 objects are the same, independent of their representation
 * (e.g. Pointer, Object)
 */
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

Parse.MockDB = {
  mockDB: mockDB,
  cleanUp: cleanUp,
  promiseResultSync: promiseResultSync,
};

module.exports = Parse.MockDB;
