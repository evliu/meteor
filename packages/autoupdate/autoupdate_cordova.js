var autoupdateVersionCordova = __meteor_runtime_config__.autoupdateVersionCordova || "unknown";

// The collection of acceptable client versions.
ClientVersions = new Meteor.Collection("meteor_autoupdate_clientVersions");

Autoupdate = {};

Autoupdate.newClientAvailable = function () {
  return !! ClientVersions.findOne({
    _id: 'version-cordova',
    version: {$ne: autoupdateVersionCordova}
  });
};

var writeFile = function (directoryPath, fileName, content, cb) {
  var fail = function (err) {
    cb(new Error("Failed to write file: ", err), null);
  };
  window.resolveLocalFileSystemURL(directoryPath,
    function (dirEntry) {
      var success = function (fileEntry) {
        fileEntry.createWriter(function (writer) {
          writer.onwrite = function (evt) {
            var result = evt.target.result;
            cb(null, result);
          };
          writer.onerror = fail;
          writer.write(content);
        }, fail);
      };

      dirEntry.getFile(fileName, { create: true, exclusive: false },
        success, fail);
    }, fail);
};

var hasCalledReload = false;
var onNewVersion = function () {
  var ft = new FileTransfer();
  var urlPrefix = Meteor.absoluteUrl() + '__cordova';

  var localPathPrefix = cordova.file.applicationStorageDirectory +
                        'Documents/meteor/';


  HTTP.get(urlPrefix + '/manifest.json', function (err, res) {
    if (err || ! res.data) {
      console.log('failed to download the manifest ' + (err && err.message) + ' ' + (res && res.content));
      return;
    }

    var program = res.data;
    var manifest = program.manifest;
    var version = program.version;
    var ft = new FileTransfer();
    var downloads = 0;
    _.each(manifest, function (item) {
      if (item.url) downloads++;
    });

    var versionPrefix = localPathPrefix + version;

    var afterAllFilesDownloaded = _.after(downloads, function () {
      writeFile(versionPrefix, 'manifest.json',
          JSON.stringify(program, undefined, 2),
          function (err) {

        if (err) {
          console.log("Failed to write manifest.json");
          // XXX do something smarter?
          return;
        }

        // success! downloaded all sources and saved the manifest
        // save the version string for atomicity
        writeFile(localPathPrefix, 'version', version,
            function (err) {
          if (err) {
            console.log("Failed to write version");
            return;
          }

          // don't call reload twice!
          if (! hasCalledReload) {
            Package.reload.Reload._reload();
          }
        });
      });
    });

    _.each(manifest, function (item) {
      if (! item.url) return;

      // Add a cache buster to ensure that we don't cache an old asset.
      var uri = encodeURI(urlPrefix + item.url + '?' + Random.id());

      // Try to dowload the file a few times.
      var tries = 0;
      var tryDownload = function () {
        ft.download(uri, versionPrefix + item.url, function (entry) {
          if (entry) {
            afterAllFilesDownloaded();
          }
        }, function (err) {
          // It failed, try again if we have tried less than 5 times.
          if (tries++ < 5) {
            tryDownload();
          } else {
            console.log('fail source: ', error.source);
            console.log('fail target: ', error.target);
          }
        });
      };

      tryDownload();
    });
  });
};

var retry = new Retry({
  minCount: 0, // don't do any immediate retries
  baseTimeout: 30*1000 // start with 30s
});
var failures = 0;

Autoupdate._retrySubscription = function () {
 Meteor.subscribe("meteor_autoupdate_clientVersions", {
    onError: function (error) {
      Meteor._debug("autoupdate subscription failed:", error);
      failures++;
      retry.retryLater(failures, function () {
        // Just retry making the subscription, don't reload the whole
        // page. While reloading would catch more cases (for example,
        // the server went back a version and is now doing old-style hot
        // code push), it would also be more prone to reload loops,
        // which look really bad to the user. Just retrying the
        // subscription over DDP means it is at least possible to fix by
        // updating the server.
        Autoupdate._retrySubscription();
      });
    }
  });
  if (Package.reload) {
    var checkNewVersionDocument = function (doc) {
      var self = this;
      if (doc.version !== autoupdateVersionCordova) {
        onNewVersion();
      }
    };

    var handle = ClientVersions.find({
      _id: 'version-cordova'
    }).observe({
      added: checkNewVersionDocument,
      changed: checkNewVersionDocument
    });
  }
};

Meteor.startup(Autoupdate._retrySubscription);
