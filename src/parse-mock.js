var _ = require('lodash'),
  sinon = require('sinon'),
  Parse = require('parse'),

  registeredStubs = [],
  db = {},

  stubMethods;

if (typeof Parse.Parse != 'undefined') {
  Parse = Parse.Parse;
}

stubMethods = {
  stubCollectionFetch: {'object': Parse.Collection.prototype, methodName: 'fetch' , numArgs: 0},
  stubConfigGet: {'object': Parse.Config, methodName: 'get' , numArgs: 0},
  stubQueryFind: {'object': Parse.Query.prototype, methodName: 'find' , numArgs: 0},
  stubQueryFirst: {'object': Parse.Query.prototype, methodName: 'first' , numArgs: 0},
  stubQueryGet: {'object': Parse.Query.prototype, methodName: 'get' , numArgs: 1},
  stubQueryCount: {'object': Parse.Query.prototype, methodName: 'count' , numArgs: 0},
  stubObjectSave: {'object': Parse.Object.prototype, methodName: 'save' , numArgs: 0},
  stubObjectFetch: {'object': Parse.Object.prototype, methodName: 'fetch' , numArgs: 0},
  stubObjectDestroy: {'object': Parse.Object.prototype, methodName: 'destroy', numArgs: 0},
};

for (var key in stubMethods) {
  var object = stubMethods[key].object,
  methodName = stubMethods[key].methodName,
  numArgs = stubMethods[key].numArgs;

  (function (object, methodName, numArgs) {
    stubMethods[key] = function (cb) {
      return registerStub(sinon.stub(object, methodName, function () {
        var promise = new Parse.Promise()._thenRunCallbacks();
        if (numArgs == 0) {
          data = cb.call(this, queryToJSON(this));
        } else if (numArgs == 1) {
          data = cb.call(this, queryToJSON(this), arguments[0]);
        }

        if (methodName == "save") {
          return data;
        }

        if (data) {
          data = addDefaultFields(data);
        }

        promise.resolve(data);

        return promise;
      }));
    };
  })(object, methodName, numArgs);

}

function mockDB() {
  mockRequests();
  var realSave = Parse.Object.prototype.save;
  Parse.Mock.stubObjectSave(function(options) {
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
  storedItem.__type = "Object";
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
            return (object[key] !== undefined) &&
              (target == object[key] ||
               (target.objectId !== undefined && target.objectId == object[key].id));
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

function cleanUp() {
  db = {};
  clearStubs();
}

function mockRequests() {
  registerStub(sinon.stub(Parse, '_request', function(options) {
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
  }));
}

function stubGetRequest(options) {
  var classMatches = db[options.className];
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

  var promise = new Parse.Promise.as(defaultFields());
  return promise;
}

function promiseResultSync(promise) {
  var result;
  promise.then(function(res) {
    result = res;
  });

  return result;
}

Parse.Mock = _.extend(stubMethods, {
  mockDB: mockDB,
  cleanUp: cleanUp,
  mockRequests: mockRequests,
  clearStubs: clearStubs,
  promiseResultSync: promiseResultSync,
});

module.exports = Parse.Mock;

function registerStub(stub) {
  registeredStubs.push(stub);

  return stub;
}

function clearStubs() {
  registeredStubs.forEach(function (stub) {
    stub.restore();
  })

}

function queryToJSON(query) {
  return _.extend(query.toJSON(), {
    className: query.className
  });
}

/**
 * Extends object tree with server-genereated fields
 *
 * @param data Array|Parse.Object
 * @returns {*}
 */

function addDefaultFields(data) {
  if (Array.isArray(data)) {
    return _.map(data, function (d) {
      return addDefaultFields(d);
    })
  }

  //todo: loop if array passed
  //todo: walk model recursively
  //todo: don't override if exists

  return _.defaults(data, defaultFields());
}

function defaultFields() {
  return {
    id:  _.uniqueId(),
    createdAt: (new Date()).toJSON(),
    updatedAt: (new Date()).toJSON()
  };
}
