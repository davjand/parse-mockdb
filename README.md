Parse MockDB
=====================

Master Build Status: [![Circle CI](https://circleci.com/gh/HustleInc/parse-mockdb/tree/master.svg?style=svg)](https://circleci.com/gh/HustleInc/parse-mockdb/tree/master)

(Originally forked from parse-mock, https://github.com/dziamid/parse-mock)

Provides a mock Parse backend and automatic stubbing of `Parse.Object.save()` and `Parse._request` to help unit test Parse cloud logic written in JavaScript.  Simply call `Parse.MockDB.mockDB()`, and Parse MockDB will store models in memory and query / filter them appropriately.

Supports the following methods of the Parse JS SDK (promise-form only):

```
Object.set()
Object.save()

Query.find()
Query.first()
Query.get()

Query.containedIn()
Query.equalTo()
Query.include()
Query.notContainedIn()
Query.matchesKeyInQuey()
Query.or()
```

Please help development of this library by adding additional features!

## Installation

```
npm install parse-mockdb --save-dev
```

## Tests

```
mocha test/test.js
```

## Example Test (see also test/test.js)

```
describe('Parse MockDB Test', function () {
  beforeEach(function() {
    Parse.MockDB.mockDB();
  });

  afterEach(function() {
    Parse.MockDB.cleanUp();
  });

  it('should save and find an item', function (done) {
    var Item = Parse.Object.extend("Item");
    var item = new Item();
    item.set("price", 30);
    item.save().then(function(item) {
      var query = new Parse.Query(Item);
      query.equalTo("price", 30);
      return query.find().then(function(items) {
        assert(items[0].get("price") == 30);
        done();
      });
    });
  });
});
```
