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
  stubCollectionFetch: [Parse.Collection.prototype, 'fetch'],
  stubConfigGet: [Parse.Config, 'get'],
  stubQueryFind: [Parse.Query.prototype, 'find'],
  stubQueryFirst: [Parse.Query.prototype, 'first'],
  stubQueryGet: [Parse.Query.prototype, 'get'],
  stubQueryCount: [Parse.Query.prototype, 'count'],
  stubObjectSave: [Parse.Object.prototype, 'save'],
  stubObjectFetch: [Parse.Object.prototype, 'fetch'],
  stubObjectDestroy: [Parse.Object.prototype, 'destroy']
};

for (var key in stubMethods) {
  var object = stubMethods[key][0],
    methodName = stubMethods[key][1];

  (function (object, methodName) {
    stubMethods[key] = function (cb) {
      return registerStub(sinon.stub(object, methodName, function (options) {
        var promise = new Parse.Promise()._thenRunCallbacks(options),
        data = cb.call(this, queryToJSON(this));

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
  })(object, methodName);

}

function mockDB() {
  mockSaveRequests();
  var realSave = Parse.Object.prototype.save;
  Parse.Mock.stubObjectSave(function(options) {
    return realSave.call(this, options).then(function(savedObj) {
      // save to our local db
      db[options.className] = db[options.className] || [];
      db[options.className].push(savedObj);

      return savedObj;
    });
  });

  Parse.Mock.stubQueryFind(function(options) {
    var classMatches = db[options.className];
    var matches = _.filter(classMatches, queryFilter(options.where));
    return matchesAfterIncluding(matches, options.include);
  });

  Parse.Mock.stubQueryFirst(function(options) {
    var classMatches = db[options.className];
    var matches = _.filter(classMatches, queryFilter(options.where));
    return _.first(matchesAfterIncluding(matches, options.include));
  });
}

function matchesAfterIncluding(matches, includeClause) {
  if (!includeClause) {
    return matches;
  }

  includeClauses = includeClause.split(",");
  matches = _.map(matches, function(match) {
    for (var i = 0; i < includeClauses.length; i++) {
      var paths = includeClauses[i].split(".");
      match = objectAfterReplacingPointerAtIncludePath(match, paths);
    }
    return match;
  });

  return matches;
}

function objectAfterReplacingPointerAtIncludePath(object, paths) {
  var path = paths.shift();
  var obj = objectForPointer(object.get(path));
  if (paths.length != 0) {
    object.attributes[path] = objectAfterReplacingPointerAtIncludePath(obj, paths);
  }
  return object
};

function objectForPointer(pointer) {
  var className, objectId;
  if (pointer.id && pointer.className) {
    objectId = pointer.id;
    className = pointer.className;
  } else {
    className = pointer["className"];
    objectId = pointer["objectId"];
  }
  var storedItem = _.find(db[className], function(obj) { return obj.id == objectId; });
  return storedItem;
}

function queryFilter(whereClause) {
  return function(object) {
    return _.reduce(whereClause, function(result, n, key) {
      var whereParams = whereClause[key];
      var match;
      if (typeof whereParams == "object") {
        if (whereParams["$in"]) {
          // containedIn

          match = _.indexOf(whereParams["$in"], object.get(key)) != -1;
        } else if (whereParams["__type"] == "Pointer") {
          // match on an object
          var storedItem = objectForPointer(whereParams);
          match = object.get(key).id == storedItem.id;
        } else {
          throw new Error("unknown query where clause: " + JSON.stringify(whereParams));
        }
      } else if (whereParams) {
        // simple match
        match = object.get(key) == whereParams;
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

function mockSaveRequests() {
  registerStub(sinon.stub(Parse, '_request', function(options) {
    if (options.route != "classes" && options.method != "POST") {
      return Parse._request(options);
    }

    var promise = new Parse.Promise.as(defaultFields());
    return promise;
  }));
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
  mockSaveRequests: mockSaveRequests,
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
    createdAt: new Date(),
    updatedAt: new Date()
  };
}
