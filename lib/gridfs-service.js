const _ = require('lodash');
const Busboy = require('busboy');
const GridFS = require('gridfs-stream');
const ZipStream = require('zip-stream');
const mongodb = require('mongodb');
const { GridFSBucket } = require('mongodb');
const MongoClient = mongodb.MongoClient;
module.exports = GridFSService;

function GridFSService(options) {
  if (!(this instanceof GridFSService)) {
    return new GridFSService(options);
  }

  this.options = options;
}

/**
 * Connect to mongodb if necessary.
 */
GridFSService.prototype.connect = async function (callback) {
  var self = this;
  var url;
  if (!self.options.url) {
    url = (self.options.username && self.options.password) ?
      'mongodb://{$username}:{$password}@{$host}:{$port}/{$database}' :
      'mongodb://{$host}:{$port}/{$database}';

    // replace variables

    url = url.replace(/\{\$([a-zA-Z0-9]+)\}/g, (pattern, option) => {
      return self.options[option] || pattern;
    });
  } else {
    url = self.options.url;
  }

  const excludeOptions = ['url', 'username', 'password', 'host', 'port', 'database', 'name', 'connector', 'debug'];
  const validOptions = _.omit(this.options, excludeOptions);
  // connect
  try {
    const client = await MongoClient.connect(url, validOptions);
    this.db = client.db(this.options.database);
    // Set frequently used collections
    this.files = this.db.collection('fs.files');
    this.chunks = this.db.collection('fs.chunks');
    if (callback) callback(null, this.db);
  } catch (error) {
    if (callback) callback(error);
    else throw error;
  }
  db=this.db;
  return this.db;
};

/**
 * List all storage containers
 */

GridFSService.prototype.getContainers = function (cb) {
  var collection = this.files;

  collection.find({ 'metadata.container': { $exists: true } }).toArray(function (error, files) {
    var containerList = [];

    if (!error) {
      containerList = _(files).map('metadata.container').uniq().value();
    }

    return cb(error, containerList);
  });
};

/**
 * Elimina todos los ficheros que cumplen con la condición
 */

GridFSService.prototype.delete = function (where, cb) {
  const fs_files = this.files;
  const fs_chunks = this.chunks;

  fs_files.find(where, { _id: 1 }).toArray((error, containerFiles) => {
    if (!containerFiles || containerFiles.length <= 0) {
      return cb(error);
    }

    const files = containerFiles.map(file => file._id);

    fs_chunks.deleteMany({ 'files_id': { $in: files } }, (error) => {
      if (error) {
        return cb(error);
      }

      fs_files.deleteMany({ '_id': { $in: files } }, (error) => {
        return cb(error);
      });
    });
  });
};

/**
 * Delete an existing storage container.
 */
GridFSService.prototype.deleteContainer = function (containerName, cb) {
  var fs_files = this.files;
  var fs_chunks = this.chunks;

  fs_files.find({ 'metadata.container': containerName }, { _id: 1 }).toArray(function (error, containerFiles) {
    if (!containerFiles || containerFiles.length <= 0) {
      return cb(error);
    }

    var files = [];

    for (var index in containerFiles) {
      files.push(containerFiles[index]._id);
    }

    fs_chunks.deleteMany({
      'files_id': { $in: files }
    }, function (error) {
      if (error) {
        return cb(error);
      }

      fs_files.deleteMany({
        'metadata.container': containerName
      }, function (error) {
        return cb(error);
      });
    });
  });
};

/**
 * Delete files an existing storage container
 * @param {{string}} container Container
 * @param {{string}} type Type of file: attachment or image
 */

GridFSService.prototype.deleteFilesContainerByType = function (container, type, cb) {
  var fs_files = this.files;
  var fs_chunks = this.chunks;

  fs_files.find({ 'metadata.container': container, 'metadata.type': type }, { _id: 1 }).toArray(function (error, containerFiles) {
    if (!containerFiles || containerFiles.length <= 0) {
      return cb(error);
    }

    var files = [];

    for (var index in containerFiles) {
      files.push(containerFiles[index]._id);
    }

    fs_chunks.deleteMany({
      'files_id': { $in: files }
    }, function (error) {
      if (error) {
        return cb(error);
      }

      fs_files.deleteMany({
        'metadata.container': container
      }, function (error) {
        return cb(error);
      });
    });
  });
};

/**
 * List all files within the given container.
 */
GridFSService.prototype.getFiles = function (containerName, cb) {
  var collection = this.files;

  collection.find({
    'metadata.container': containerName
  }).toArray(function (error, container) {
    return cb(error, container);
  });
};

/**
 * List all files within the given container.
 */
GridFSService.prototype.getFilesByType = async function (container, type, cb) {
  return await this.files.find({
      'metadata.container': container,
      'metadata.type': type
    }, { sort: 'filename' }).toArray();
};

/**
 * List all the files that meet the conditions
 */

GridFSService.prototype.findFiles = function (where, cb) {
  const collection = this.files;

  collection.find(where, { sort: 'filename' }).toArray(function (error, files) {
    return cb(error, files);
  });
};

/**
 * Return a file with the given id within the given container.
 */
GridFSService.prototype.getFile = function (containerName, fileId, cb) {
  var collection = this.files;

  collection.find({
    '_id': new mongodb.ObjectId(fileId),
    'metadata.container': containerName
  }).limit(1).next(function (error, file) {
    if (!file) {
      error = new Error('Not found.');
      error.status = 404;
    }
    return cb(error, file || {});
  });
};

/**
 * Return a file with the given filename within the given container.
 */
GridFSService.prototype.getFileByName = function (containerName, filename, cb) {
  var collection = this.files;

  collection.find({
    'metadata.filename': filename,
    'metadata.container': containerName
  }).limit(1).next(function (error, file) {
    if (!file) {
      error = new Error('Not found');
      error.status = 404;
    }
    return cb(error, file || {});
  });
};

/**
 * Delete an existing file with the given id within the given container.
 */
GridFSService.prototype.deleteFile = function (containerName, fileId, cb) {
  var fs_files = this.files;
  var fs_chunks = this.chunks;

  fs_files.deleteOne({
    '_id': new mongodb.ObjectId(fileId),
    'metadata.container': containerName
  }, function (error) {
    if (error) {
      return cb(error);
    }

    fs_chunks.deleteOne({
      'files_id': new mongodb.ObjectId(fileId)
    }, function (error) {
      cb(error);
    });
  });
};

/**
 * Delete an existing file with the given id file.
 */

GridFSService.prototype.deleteFileByFileId = function (fileId, cb) {
  var fs_files = this.files;
  var fs_chunks = this.chunks;

  fs_files.deleteOne({
    '_id': new mongodb.ObjectId(fileId)
  }, function (error) {
    if (error) {
      return cb(error);
    }

    fs_chunks.deleteOne({
      'files_id': new mongodb.ObjectId(fileId)
    }, function (error) {
      cb(error);
    });
  });
};

/**
 * Delete an existing file with the given name within the given container.
 */
GridFSService.prototype.deleteFileByName = function (containerName, filename, cb) {
  var fs_files = this.files;
  var fs_chunks = this.chunks;

  fs_files.find({ 'metadata.container': containerName, 'metadata.filename': filename }, { _id: 1 }).toArray(function (error, containerFiles) {
    if (!containerFiles || containerFiles.length <= 0) {
      return cb(error);
    }

    var files = [];

    for (var index in containerFiles) {
      files.push(containerFiles[index]._id);
    }

    fs_chunks.deleteMany({
      'files_id': { $in: files }
    }, function (error) {
      if (error) {
        return cb(error);
      }

      fs_files.deleteMany({
        'metadata.filename': filename,
        'metadata.container': containerName
      }, function (error) {
        return cb(error);
      });
    });
  });
};

/**
 * Upload middleware for the HTTP request.
 */
GridFSService.prototype.upload = function (containerName, req, cb) {
  var self = this;

  var busboy = new Busboy({
    headers: req.headers
  });

  busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
    var options = {
      _id: new mongodb.ObjectId(),
      filename: filename,
      metadata: {
        container: containerName,
        filename: filename,
        mimetype: mimetype
      },
      mode: 'w'
    };

    var gridfs = new GridFS(self.db, mongodb);
    var stream = gridfs.createWriteStream(options);

    stream.on('close', function (file) {
      return cb(null, file);
    });

    stream.on('error', cb);

    // if (self.options.compressImages) {
    //   const resize = sharp()
    //     .rotate()
    //     .resize(1500);

    //   switch (mimetype) {
    //     case 'image/jpg':
    //     case 'image/jpeg':
    //       file = file.pipe(resize.jpeg({ quality: 80 }));
    //       break;
    //     case 'image/png':
    //     case 'image/gif':
    //       file = file.pipe(resize.png({ compressionLevel: 8 }));
    //       break;
    //   }
    // }

    file.pipe(stream);
  });

  req.pipe(busboy);
};

/**
 * Upload middleware for the HTTP request.
 */
GridFSService.prototype.uploadWithMetadata = function (containerName, metadata, req, cb) {
  self = this;

  var busboy = new Busboy({
    headers: req.headers
  });

  busboy.on('file', function (fieldname, file, filename, encoding, mimetype) {
    // Añadir a los metadatos incluidos por el usuario el nombre del contenedor,
    // nombre del fichero y el mime type del fichero

    metadata = metadata || {};
    metadata.container = containerName;
    metadata.filename = filename;
    metadata.mimetype = mimetype;
    metadata.uploadUserId = metadata.uploadUserId.toString();

    var options = {
      filename: filename,
      metadata: metadata,
      mode: 'w',
      contentType: 'binary/octet-stream',
      aliases: null,

    };

    const bucket = new mongodb.GridFSBucket(db);
    var stream = bucket.openUploadStream(filename, options);

    stream.on('finish', cb);
    stream.on('error', cb);

    file.pipe(stream);
  });

  req.pipe(busboy);
};

/**
 * Download middleware for the HTTP request.
 */

GridFSService.prototype.download = function (fileId, res, req, cb) {
  this.files.findOne({
    '_id': new mongodb.ObjectId(fileId)
  }).then(function (file) {
    if (!file) {
      throw new Error('Not found.');
    }

    var gridfs = new GridFSBucket(this.db);

    res.set('Content-Type', file.metadata.mimetype);
    res.set('Content-Transfer-Encoding', 'binary');
    res.set('Content-Disposition', `attachment;filename=${file.filename}`);

    if (!!req.headers && !!req.headers['range']) {
      rangeStart = parseInt(req.headers['range'].split('=')[1].split('-')[0]);
      rangeEnd = parseInt(req.headers['range'].split('=')[1].split('-')[1]);
    }

    if (!req.headers || !req.headers['range'] || isNaN(rangeEnd)) {
      var stream = gridfs.openDownloadStream(new mongodb.ObjectId(file._id));
      res.set('Content-Length', file.length);

      res.status(200);

    } else {

      var stream = gridfs.openDownloadStream(new mongodb.ObjectId(file._id),
       { range: {
          startPos: rangeStart,
          endPos: rangeEnd,
        }
      });
      res.set('Accept-Ranges', 'bytes');
      res.set('Content-Length', rangeEnd + 1 - rangeStart);
      res.set('Content-Range', `bytes ${rangeStart}-${rangeEnd}/${file.length}`);

      res.status(206);
    }

    return stream.pipe(res);
  });
};

GridFSService.prototype.downloadContainer = function (containerName, req, res, cb) {
  var self = this;

  var collection = this.files;

  collection.find({
    'metadata.container': containerName
  }).toArray(function (error, files) {
    if (files.length === 0) {
      error = new Error('Archivo sin ficheros.');
      error.status = 404;
    }

    if (error) {
      return cb(error);
    }

    var gridfs = new GridFS(self.db, mongodb);
    var archive = new ZipStream();

    function next() {
      if (files.length > 0) {
        var file = files.pop();
        var fileStream = gridfs.createReadStream({ _id: file._id });

        archive.entry(fileStream, { name: file.filename }, next);
      } else {
        archive.finish();
      }
    }

    next();

    var filename = req.query.filename || 'file';

    res.set('Content-Disposition', `attachment;filename=${filename}.zip`);
    res.set('Content-Type', 'application/zip');

    return archive.pipe(res);
  });
};

/**
 * Método que descarga un listado de ficheros comprimidos en formato zip
 * @param {{string}} filesId Cadena con los identificadores de los ficheros
 * a descargar comprimidos separados por comas
 */

GridFSService.prototype.downloadZipFiles = function (filesId, res, cb) {
  if (!filesId) {
    return cb(new Error('Ficheros no especificados.'));
  }

  const Ids = filesId.split(',').map(id => new mongodb.ObjectId(id));

  this.files.find({ '_id': { $in: Ids } }).then((files) => {
    if (files.length === 0) {
      error = new Error('No se han encontrado los ficheros a descargar.');
      error.status = 404;
    }

    if (error) {
      return cb(error);
    }

    const bucket = new GridFSBucket(this.db);
    var archive = new ZipStream();

    function next() {
      if (files.length > 0) {
        var file = files.pop();
        var fileStream = bucket.createReadStream({ _id: file._id });

        archive.entry(fileStream, { name: file.filename }, next);
      } else {
        archive.finish();
      }
    }

    next();

    const fecha = new Date();
    const filename = `documentos-${fecha.getFullYear()}${fecha.getMonth() + 1}${fecha.getDate()}`;

    res.set('Content-Disposition', `attachment;filename=${filename}.zip`);
    res.set('Content-Type', 'application/zip');

    return archive.pipe(res);
  });
};

/**
 * Download middleware for the HTTP request.
 */
GridFSService.prototype.downloadInline = function (fileId, res, cb) {
  this.files.findOne({
    '_id': new mongodb.ObjectId(fileId)
  })
  .then((file) => {

    if (!file) {
      throw new Error('File not found.');
    }

    res.set('Content-Type', file.metadata.mimetype);
    res.set('Content-Disposition', `inline; filename="${file.filename}"`);
    const bucket = new GridFSBucket(this.db);
    const ds = bucket.openDownloadStream(new mongodb.ObjectId(fileId));
    ds.pipe(res);
  });
};

/**
 * Get stream fileId.
 */

GridFSService.prototype.getStreamFileId = function (fileId, cb) {
  var self = this;

  var collection = this.files;

  collection.find({
    '_id': new mongodb.ObjectId(fileId)
  }).limit(1).next(function (error, file) {
    if (!file) {
      error = new Error('Not found.');
      error.status = 404;
    }

    if (error) {
      return cb(error);
    }

    var gridfs = new GridFS(self.db, mongodb);

    return cb(null, gridfs.createReadStream({ _id: file._id }));
  });
};

/**
 * Download middleware for the HTTP request.
 */
GridFSService.prototype.downloadInlineByName = function (containerName, filename, res, cb) {
  var self = this;

  var collection = this.files;

  collection.find({
    'metadata.filename': filename,
    'metadata.container': containerName
  }).limit(1).next(function (error, file) {
    if (!file) {
      error = new Error(`Fichero "${filename}" no encontrado.`);
      error.status = 404;
    }

    if (error) {
      return cb(error);
    }

    var gridfs = new GridFS(self.db, mongodb);
    var stream = gridfs.createReadStream({
      _id: file._id
    });

    // set headers
    res.set('Content-Type', file.metadata.mimetype);
    res.set('Content-Length', file.length);
    res.set('Content-Disposition', `inline;filename=${file.filename}`);

    return stream.pipe(res);
  });
};

GridFSService.modelName = 'storage';

/*
 * Routing options
 */

/*
 * GET /FileContainers
 */
GridFSService.prototype.getContainers.shared = true;
GridFSService.prototype.getContainers.accepts = [];
GridFSService.prototype.getContainers.returns = {
  arg: 'containers',
  type: 'array',
  root: true
};
GridFSService.prototype.getContainers.http = {
  verb: 'get',
  path: '/'
};

/*
 * DELETE /FileContainers/deleteFileByWhere/:where
 */
GridFSService.prototype.delete.shared = true;
GridFSService.prototype.delete.accepts = [
  { arg: 'where', type: 'string', description: 'Where sentence' }
];
GridFSService.prototype.deleteContainer.returns = {};
GridFSService.prototype.deleteContainer.http = {
  verb: 'delete',
  path: '/deleteFileByWhere/:where'
};

/*
 * DELETE /FileContainers/:containerName
 */
GridFSService.prototype.deleteContainer.shared = true;
GridFSService.prototype.deleteContainer.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } }
];
GridFSService.prototype.deleteContainer.returns = {};
GridFSService.prototype.deleteContainer.http = {
  verb: 'delete',
  path: '/:containerName'
};

/*
 * GET /FileContainers/:containerName/files
 */
GridFSService.prototype.getFiles.shared = true;
GridFSService.prototype.getFiles.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } }
];
GridFSService.prototype.getFiles.returns = {
  type: 'array',
  root: true
};
GridFSService.prototype.getFiles.http = {
  verb: 'get',
  path: '/:containerName/files'
};

/*
 * GET /FileContainers/:containerName/files/:fileId
 */
GridFSService.prototype.getFile.shared = true;
GridFSService.prototype.getFile.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'fileId', type: 'string', description: 'File id', http: { source: 'path' } }
];
GridFSService.prototype.getFile.returns = {
  type: 'object',
  root: true
};
GridFSService.prototype.getFile.http = {
  verb: 'get',
  path: '/:containerName/files/:fileId'
};

/*
 * GET /FileContainers/:containerName/getFileByName/:filename
 */
GridFSService.prototype.getFileByName.shared = true;
GridFSService.prototype.getFileByName.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'filename', type: 'string', description: 'File name', http: { source: 'path' } }
];
GridFSService.prototype.getFileByName.returns = {
  type: 'object',
  root: true
};
GridFSService.prototype.getFileByName.http = {
  verb: 'get',
  path: '/:containerName/getFileByName/:filename'
};

/*
 * DELETE /FileContainers/:containerName/files/:fileId
 */
GridFSService.prototype.deleteFile.shared = true;
GridFSService.prototype.deleteFile.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'fileId', type: 'string', description: 'File id', http: { source: 'path' } }
];
GridFSService.prototype.deleteFile.returns = {};
GridFSService.prototype.deleteFile.http = {
  verb: 'delete',
  path: '/:containerName/files/:fileId'
};

/*
 * DELETE /FileContainers/files/:fileId
 */
GridFSService.prototype.deleteFileByFileId.shared = true;
GridFSService.prototype.deleteFileByFileId.accepts = [
  { arg: 'fileId', type: 'string', description: 'File id', http: { source: 'path' } }
];
GridFSService.prototype.deleteFileByFileId.returns = {};
GridFSService.prototype.deleteFileByFileId.http = {
  verb: 'delete',
  path: '/files/:fileId'
};

/*
 * DELETE /FileContainers/:containerName/deleteFileByName/:filename
 */
GridFSService.prototype.deleteFileByName.shared = true;
GridFSService.prototype.deleteFileByName.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'filename', type: 'string', description: 'File name', http: { source: 'path' } }
];
GridFSService.prototype.deleteFileByName.returns = {};
GridFSService.prototype.deleteFileByName.http = {
  verb: 'delete',
  path: '/:containerName/deleteFileByName/:filename'
};

/*
 * POST /FileContainers/:containerName/upload
 */
GridFSService.prototype.upload.shared = true;
GridFSService.prototype.upload.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'req', type: 'object', http: { source: 'req' } }
];
GridFSService.prototype.upload.returns = {
  arg: 'file',
  type: 'object',
  root: true
};
GridFSService.prototype.upload.http = {
  verb: 'post',
  path: '/:containerName/upload'
};

/*
 * GET /FileContainers/download
 */
GridFSService.prototype.download.shared = true;
GridFSService.prototype.download.accepts = [
  { arg: 'fileId', type: 'string', description: 'File id' },
  { arg: 'res', type: 'object', 'http': { source: 'res' } },
  { arg: 'req', type: 'object', 'http': { source: 'req' } }
];
GridFSService.prototype.download.http = {
  verb: 'get',
  path: '/download'
};

/*
 * GET /FileContainers/:containerName/download/zip
 */
GridFSService.prototype.downloadContainer.shared = true;
GridFSService.prototype.downloadContainer.accepts = [
  { arg: 'containerName', type: 'string', description: 'Container name', http: { source: 'path' } },
  { arg: 'req', type: 'object', 'http': { source: 'req' } },
  { arg: 'res', type: 'object', 'http': { source: 'res' } }
];
GridFSService.prototype.downloadContainer.http = {
  verb: 'get',
  path: '/:containerName/zip'
};

/*
 * GET /FileContainers/downloadZipFiles
 */
GridFSService.prototype.downloadZipFiles.shared = true;
GridFSService.prototype.downloadZipFiles.accepts = [
  { arg: 'filesId', type: 'string', description: 'Cadena de Id Files separados por comas' },
  { arg: 'res', type: 'object', 'http': { source: 'res' } }
];
GridFSService.prototype.downloadZipFiles.http = {
  verb: 'get',
  path: '/downloadZipFiles'
};

/*
 * GET /FileContainers/downloadInline/:fileId
 */
GridFSService.prototype.downloadInline.shared = true;
GridFSService.prototype.downloadInline.accepts = [
  { arg: 'fileId', type: 'string', description: 'File id', http: { source: 'path' } },
  { arg: 'res', type: 'object', 'http': { source: 'res' } }
];
GridFSService.prototype.downloadInline.http = {
  verb: 'get',
  path: '/downloadInline/:fileId'
};

/*
 * GET /FileContainers/getStreamFileId/:fileId
 */
GridFSService.prototype.getStreamFileId.shared = true;
GridFSService.prototype.getStreamFileId.accepts = [
  { arg: 'fileId', type: 'string', description: 'File id', http: { source: 'path' } }
];
GridFSService.prototype.getStreamFileId.http = {
  verb: 'get',
  path: '/getStreamFileId/:fileId'
};
