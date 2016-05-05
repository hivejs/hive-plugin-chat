/** 
 * hive.js 
 * Copyright (C) 2013-2016 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the Mozilla Public License version 2
 * as published by the Mozilla Foundation.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the Mozilla Public License
 * along with this program.  If not, see <https://www.mozilla.org/en-US/MPL/2.0/>.
 */
var path = require('path')
  , co = require('co')
  , through = require('through2')
  , JSONParse = require('json-stream')

module.exports = setup
module.exports.consumes = ['ui', 'broadcast', 'auth', 'logger']

function setup(plugin, imports, register) {
  var ui = imports.ui
    , broadcast = imports.broadcast
    , auth = imports.auth
    , logger = imports.logger.getLogger('plugin-chat')

  ui.registerModule(path.join(__dirname, 'client.js'))
  ui.registerStylesheet(path.join(__dirname, 'css/index.css'))
  ui.registerLocaleDir(path.join(__dirname, 'locales'))

  broadcast.registerChannel(new Buffer('chat'), function(user, docId, clientStream, broadcastStream) {
    // Authorize chat:write
    clientStream.pipe(JSONParse()).pipe(through.obj(function(buf, enc, cb){
      var that = this
      co(function*() {
        var authorized = yield auth.authorize(user, 'document/chat:write', {document: docId})
        if(!authorized) {
          logger.debug('Dropped chat message because of lack of authorization')
          return cb()
        }
        if(buf.user != user.id) {
          logger.debug('Dropped chat the author of the message is not the sender.')
          return cb()
        }
        that.push(buf)
      }).then(cb).catch(cb)
    })).pipe(JSONStringify()).pipe(broadcastStream)

    // Athorize chat:read
    broadcastStream.pipe(through(function(buf, enc, cb) {
      var that = this
      co(function*() {
        var authorized = yield auth.authorize(user, 'document/chat:read', {document: docId})
        if(!authorized) return cb()
        that.push(buf)
      }).then(cb).catch(cb)
    })).pipe(clientStream)
  })

  register()
}


function JSONStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}
