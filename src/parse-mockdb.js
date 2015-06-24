var _ = require('lodash'),
  sinon = require('sinon'),
  Parse = require('parse'),
  db = {},
  hooks = {};

if (typeof Parse.Parse != 'undefined') {
  Parse = Parse.Parse;
}

/**
 * Mocks a Parse API server, by intercepting requests and storing/querying data locally
 * in an in-memory DB.
 */
function mockDB() {
  stubRequests();
  stubSave();
}

/**
 * Registers a function to be called whenever a model of a certain type is modified.
 *
 * @param model    | the name of the model (Parse collection name)
 * @param hookType | the type of hook/trigger type.
 * @param fn       | a function to be called when the hook is triggered that returns a
 *                 | Promise. The promise format mirrors the Parse custom webhook format:
 *                 |
 *                 | var promiseFn = function(object) {
 *                 |   // do validation
 *                 |   return Parse.Promise.as({
 *                 |     success: object
 *                 |   }); // passed validation
 *                 | }
 *
 * NOTE: only supports beforeSave hook
 */
function registerHook(model, hookType, promiseFn) {
  if (hookType !== "beforeSave") {
    throw new Error("only beforeSave hook supported");
  }

  if (hooks[model] == undefined) {
    hooks[model] = {};
  }

  hooks[model][hookType] = promiseFn;
};

/**
 * Intercepts a save() request and writes the results of the save() to our
 * in-memory DB
 */
function stubSave() {
  var realSave = Parse.Object.prototype.save;
  sinon.stub(Parse.Object.prototype, "save", function() {
    var options = this;
    var className = this.className;
    return preprocessSave(options).then(function() {
      return realSave.call(options);
    }).then(function(savedObj) {
      // save to our local db
      db[className] = db[className] || [];

      var newObject = storableFormat(savedObj, options.className);
      var index = _.findIndex(db[className], function(obj) { return obj.id == options.id; });
      if (index == -1) {
        db[options.className].push(newObject);
      } else {
        db[options.className][index] = newObject;
      }
      return savedObj;
    });
  });
}

var preprocessSave = function(options) {
  var className = options.className;
  if (hooks[className] && hooks[className]["beforeSave"]) {
    return hooks[className]["beforeSave"](options._toFullJSON()).then(function(hookResults) {
      if (hookResults.success) {
        return Parse.Promise.as(hookResults.success);
      }
    });
  }
  return Parse.Promise.as();
}

/**
 * Unstubs Parse SDK requests and clears the local DB.
 */
function cleanUp() {
  db = {};
  hooks = {};
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
  var matches = recursivelyMatch(options.className, options.data.where);
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
    object[path] = _.cloneDeep(objectAfterReplacingAtIncludePaths(obj, paths));
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
 * Given a class name and a where clause, returns DB matches by applying
 * the where clause (recursively if nested)
 */
var recursivelyMatch = function(className, whereClause) {
  var classMatches = _.cloneDeep(db[className]);
  var matches = _.filter(classMatches, queryFilter(whereClause));
  return matches;
}

/**
 * Returns a function that filters query matches on a where clause
 */
function queryFilter(whereClause) {
  if (whereClause["$or"]) {
    return function(object) {
      return _.reduce(whereClause["$or"], function(result, subclause) {
        return result || queryFilter(subclause)(object);
      }, false);
    }
  }

  return function(object) {
    if (whereClause.objectId && typeof whereClause.objectId != "object") {
      // this is a get() request. simply match on ID
      return object.id == whereClause.objectId;
    }

    return _.reduce(whereClause, function(result, whereParams, key) {
      var match = evaluateObject(object, whereParams, key);
      return result && match;
    }, true);
  };
}

// special case objectId queries
function keyAfterSpecialCasingId(key) {
  if (key === "objectId") {
    key = "id";
  }
  return key;
}

function evaluateObject(object, whereParams, key) {
  if (typeof whereParams == "object" && whereParams) {
    if (whereParams["$in"]) {
      // containedIn
      key = keyAfterSpecialCasingId(key);
      return _.find(whereParams["$in"], function(target) {
        return objectsAreEqual(target, object[key]);
      });
    } else if (whereParams["$nin"]) {
      // notContainedIn
      if (whereParams["$nin"].length == 0) {
        return true;
      }
      key = keyAfterSpecialCasingId(key);
      return _.find(whereParams["$nin"], function(target) {
        return !objectsAreEqual(target, object[key]);
      });
    } else if (whereParams["__type"] == "Pointer") {
      // match on an object
      var storedItem = fetchedObject(whereParams);
      return storedItem && object[key] && (object[key].id == storedItem.objectId);
    } else if (whereParams["$select"]) {
      var foreignKey = whereParams["$select"]["key"];
      var query = whereParams["$select"]["query"];
      var matches = recursivelyMatch(query.className, query.where);
      var objectMatches = _.filter(
        matches,
        function(match) { return object[key] == match[foreignKey]; }
      );
      return objectMatches.length > 0;
    } else if (_.has(whereParams, "$ne")) {
      return object[key] === whereParams["$ne"];
    } else {
      throw new Error("Parse-MockDB: unknown query where clause: " + JSON.stringify(whereParams));
    }
  } else if (whereParams !== undefined) {
    // simple match
    return object[key] == whereParams;
  } else {
    return true;
  }
}

/**
 * Evaluates whether 2 objects are the same, independent of their representation
 * (e.g. Pointer, Object)
 */
function objectsAreEqual(obj1, obj2) {
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
  registerHook: registerHook,
  promiseResultSync: promiseResultSync,
};

module.exports = Parse.MockDB;
