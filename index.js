/**
 * hive.js
 * Copyright (C) 2013-2015 Marcel Klehr <mklehr@gmx.net>
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 *  along with this program.  If not, see <http://www.gnu.org/licenses/>.
 */
var path = require('path')
  , co = require('co')
  , through = require('through2')
  , JSONParse = require('json-stream')

module.exports = setup
module.exports.consumes = ['assets', 'broadcast', 'auth']

function setup(plugin, imports, register) {
  var assets = imports.assets
    , broadcast = imports.broadcast
    , auth = imports.auth

  assets.registerModule(path.join(__dirname, 'client.js'))
  assets.registerStylesheet(path.join(__dirname, 'css/index.css'))

  broadcast.registerChannel(new Buffer('chat'), function(user, docId, clientStream, broadcastStream) {
    // Authorize chat:write
    clientStream.pipe(JSONParse()).pipe(through.obj(function(buf, enc, cb){
      var that = this
      co(function*() {
        var authorized = yield auth.authorize(user, 'document/chat:write', {document: docId})
        if(!authorized) return
        if(buf.user !== user.id) return
        that.push(buf)
      }).then(cb).catch(cb)
    })).pipe(JSONStringify()).pipe(broadcastStream)

    // Athorize chat:read
    broadcastStream.pipe(through(function(buf, enc, cb) {
      var that = this
      co(function*() {
        var authorized = yield auth.authorize(user, 'document/chat:read', {document: docId})
        if(!authorized) return
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
