var assert = require("assert")
require('../src/parse-mock');
var Parse = require('parse').Parse;

var Brand = Parse.Object.extend("Brand");
var Item = Parse.Object.extend("Item");
var Store = Parse.Object.extend("Store");

function createBrandP(name) {
  var brand = new Brand();
  brand.set("name", name);
  return brand.save();
}

function createItemP(price, brand) {
  var item = new Item();
  item.set("price", price);

  if (brand) {
    item.set("brand", brand);
  }
  return item.save();
}

function createStoreWithItemP(item) {
  var store = new Store();
  store.set("item", item);
  return store.save()
}

function itemQueryP(price) {
  var query = new Parse.Query(Item);
  query.equalTo("price", price);
  return query.find()
}

describe('ParseMock', function(){
  beforeEach(function() {
    Parse.Mock.mockDB();
  });

  afterEach(function() {
    Parse.Mock.cleanUp();
  });

  it("should save correctly", function(done) {
    createItemP(30).then(function(item) {
      assert(item.get("price") == 30);
      done();
    });
  });

  it("should match a correct equalTo query on price", function(done) {
    createItemP(30).then(function(item) {
      itemQueryP(30).then(function(results) {
        assert(results[0] == item);
        done();
      });
    });
  });

  it("should correctly computed nested includes", function(done) {
    createBrandP("Acme").then(function(brand) {
      createItemP(30, brand).then(function(item) {
        var brand = item.get("brand");
        createStoreWithItemP(item).then(function(savedStore) {
          var query = new Parse.Query(Store);
          query.include("item");
          query.include("item.brand");
          query.first().then(function(result) {
            var resultItem = result.get("item");
            var resultBrand = resultItem.get("brand");
            assert(resultItem == item);
            assert(resultBrand.get("name") == brand.get("name"));
            assert(resultBrand.id == brand.id);
            done();
          });
        });
      });
    });
  });

  it("should match a correct equalTo query for an object", function(done) {
    createItemP(30).then(function(item) {
      var store = new Store();
      store.set("item", item);
      store.save().then(function(savedStore) {
        var query = new Parse.Query(Store);
        query.equalTo("item", item);
        query.find().then(function(results) {
          assert(results[0] == savedStore);
          done();
        });
      });
    });
  });

  it("should not match an incorrect equalTo query on price", function(done) {
    createItemP(30).then(function(item) {
      itemQueryP(20).then(function(results) {
        assert(results.length == 0);
        done();
      });
    });
  });

  it("should not match an incorrect equalTo query on price and name", function(done) {
    createItemP(30).then(function(item) {
      var query = new Parse.Query(Item);
      query.equalTo("price", 30);
      query.equalTo("name", "pants");
      query.find().then(function(results) {
        assert(results.length == 0);
        done();
      });
    });
  });

  it("should match a correct containedIn query", function(done) {
    createItemP(30).then(function(item) {
      var query = new Parse.Query(Item);
      query.containedIn("price", [20, 30]);
      query.find().then(function(results) {
        assert(results.length == 1);
        done();
      });
    });
  });

  it("should not match an incorrect containedIn query", function(done) {
    createItemP(30).then(function(item) {
      var query = new Parse.Query(Item);
      query.containedIn("price", [40, 90]);
      query.find().then(function(results) {
        assert(results.length == 0);
        done();
      });
    });
  });

  it("should find 2 objects when there are 2 matches", function(done) {
    Parse.Promise.when([createItemP(20), createItemP(20)]).then(function(item1, item2) {
      var query = new Parse.Query(Item);
      query.equalTo("price", 20);
      query.find().then(function(results) {
        assert(results.length == 2);
        done();
      });
    });
  });

  it("should first() 1 object when there are 2 matches", function(done) {
    Parse.Promise.when([createItemP(20), createItemP(20)]).then(function(item1, item2) {
      var query = new Parse.Query(Item);
      query.equalTo("price", 20);
      query.first().then(function(result) {
        assert(result == item1);
        done();
      });
    });
  });

  it("should match a query with 1 objects when 2 objects are present", function(done) {
    Parse.Promise.when([createItemP(20), createItemP(30)]).then(function(item1, item2) {
      var query = new Parse.Query(Item);
      query.equalTo("price", 20);
      query.find().then(function(results) {
        assert(results.length == 1);
        done();
      });
    });
  });

})
