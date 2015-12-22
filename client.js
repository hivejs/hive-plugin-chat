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
var jsonParse = require('json-stream')
  , through = require('through2')
  , duplexify = require('duplexify')
  , vdom = require('virtual-dom')
  , h = vdom.h
  , ObservVarhash = require('observ-varhash')
  , ObservStruct = require('observ-struct')
  , ObservEmitter = require('observ-emitter')
  , ObservArray = require('observ-array')

module.exports = setup
module.exports.consumes = ['ui', 'editor', 'models', 'hooks']
function setup(plugin, imports, register) {
  var ui = imports.ui
    , models= imports.models
    , hooks = imports.hooks

  hooks.on('ui:initState', function*() {
    ui.state.events.put('chat:createMessage', ObservEmitter())
    ui.state.events.put('chat:minimize', ObservEmitter())
    ui.state.events.put('chat:maximize', ObservEmitter())
  })

  ui.page('/documents/:id',
  function loadClient(ctx, next) {
    if(!ui.state.user.getSetting('chat:windowSize')) {
      ui.state.user.setSetting('chat:windowSize', 'full')
    }

    ui.state.events['editor:load'].listen(function() {
      // Set up the chat broadcast
      var writable = jsonStringify()
        , readable = jsonParse()
      var chat = duplexify.obj(writable, readable)
        , broadcast = ctx.broadcast.createDuplexStream(new Buffer('chat'))
      writable.pipe(broadcast).pipe(readable)

      // set up state
      ui.state.put('chat', ObservStruct({
        messages: ObservArray([])
      , users: ObservVarhash()
      }))
      var state = ui.state.chat

      state.users.put(ui.state.user.get('id'), ui.state.user)

      // Display new chat messages
      chat.on('readable', function() {
          var msg
          while(msg = chat.read()) {
            state.messages.push(msg)
            // Check whether the user is known
            if(!state.users[msg.user]) {
              var user = new ctx.models.user({id: msg.user})
              state.users.put(msg.user, models.toObserv(user))
              user.fetch()
            }
          }
      })

      ui.state.events['chat:minimize'].listen(function() {
        ui.state.user.setSetting('chat:windowSize', 'minimized')
      })

      ui.state.events['chat:maximize'].listen(function() {
        ui.state.user.setSetting('chat:windowSize', 'full')
      })

      ui.state.events['chat:createMessage'].listen(function(text) {
        var msg = {text: text, user: ui.state.user.get('id')}
        chat.write(msg)
        state.messages.push(msg)
      })

      // inject into page
      ui.state.events['ui:renderBody'].listen(function(state, children) {
        children.push(render(state))
      })

    })

    next()
  })

  register()
}

function render(state) {
  // set window size according to user's settings
  var windowSize = state.user.settings.chat.windowSize == 'minimized'?
    '.Chat--minimized' : ''
  return h('div.Chat'+windowSize, [
    renderHeader(state)
  , renderMessages(state)
  , renderInterface(state)
  ])
}

function renderHeader(state) {
  return h('div.Chat__header', [
    h('div.btn-group.Chat__header__controls', [
      h('a.btn.glyphicon.glyphicon-minus', {
        attributes: {'aria-label':'Minimize chat window'}
      , 'ev-click': state.events['chat:minimize']
      })
    , h('a.btn.glyphicon.glyphicon-pushpin', {
        attributes: {'aria-label':'Keep chat window open'}
      , 'ev-click': state.events['chat:maximize']
      })
    ])
  , h('h5', [
      h('i.glyphicon.glyphicon-comment')
    , ' Chat '
    , h('small', 'discuss and inspire')
    ])
  ])
}

function renderInterface(state) {
  return h('form.form-inline.Chat__Interface', [
    h('div.input-group',[
      h('label.sr-only', {attributes:{for: 'message'}}, 'Chat message'),
      h('input.form-control', {attributes:{
          type:'text'
        , name: 'message'
        , placeholder: 'Chat message'
        },
        'ev-keydown': function(evt) {
        if(evt.keyCode == 13) {
          evt.preventDefault()
          state.events['chat:createMessage'](evt.currentTarget.value)
        }
      }})
    ]),
    h('input.btn.btn-default.btn-block.hidden-md.hidden-lg', {
      attributes:{type:'submit', value: 'send'}
    , 'ev-click': function(evt) {
        evt.preventDefault()
        state.events['chat:createMessage'](evt.currentTarget.previousSibling.value)
      }
    })
  ])
}

function renderMessages(state) {
  return h('div.Chat__messages', {
    scrollTop: new ScrollHook(state.chat.scrollTop)
  },
  state.chat.messages.map(function(msg) {
    return renderMessage(state, msg)
  })
  )
}

function ScrollHook() { }
ScrollHook.prototype.hook = function(node, propName, prevVal) {
  var viewportHeight = node.getBoundingClientRect().height
  if(prevVal < node.clientHeight-viewportHeight) return
  node.scrollTop = node.clientHeight
}

function renderMessage(state, msg) {
  return h('div.Chat__Message', {attributes:{'data-user': msg.user}}, [
    h('span.Chat__Message__User', state.chat.users[msg.user].name)
  , h('span.Chat__Message__Text', msg.text)
  ])
}


function jsonStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}
