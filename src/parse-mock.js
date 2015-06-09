var _ = require('lodash'),
  sinon = require('sinon'),
  Parse = require('parse'),

  registeredStubs = [],

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

        if (data) {
          data = addDefaultFields(data);
        }

        promise.resolve(data);

        return promise;
      }));
    };
  })(object, methodName);

}

/**
 * allows all Parse.Object
 */
function mockAllSaves() {
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
  mockAllSaves: mockAllSaves,
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
