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
  , co = require('co')
  , vdom = require('virtual-dom')
  , h = vdom.h

module.exports = setup
module.exports.consumes = ['ui', 'editor']
function setup(plugin, imports, register) {
  var ui = imports.ui

  var link = document.createElement('link')
  link.setAttribute('rel', 'stylesheet')
  link.setAttribute('href', 'static/hive-plugin-chat/css/index.css')
  document.head.appendChild(link)

  ui.page('/:id',
  function loadClient(ctx, next) {
    // Set up the chat broadcast
    var writable = jsonStringify()
      , readable = jsonParse()
    var chat = duplexify.obj(writable, readable)
      , broadcast = ctx.broadcast.createDuplexStream(new Buffer('chat'))
    writable.pipe(broadcast).pipe(readable)

    // Add the chat container to the screen
    var container = document.createElement('div')
    container.setAttribute('class', 'Chat')
    document.body.insertBefore(container, document.body.firstChild)

    // set window size according to user's settings
    //try {
      var windowSize = ctx.settings.get('plugin-chat:window')
      switch(windowSize) {
        case 'minimized':
          container.classList.add('Chat--minimized')
          break;
        case 'full':
          break;
      }
    //}catch(e) {}

    container.appendChild(vdom.create(renderHeader(ctx)))

    var messages = document.createElement('div')
    messages.setAttribute('class', 'Chat__messages')
    container.appendChild(messages)

    // Display new chat messages
    chat.on('readable', function() {
      co(function*() {
        var msg
        while(msg = chat.read()) {
          messages.appendChild(vdom.create(yield renderChatMessage(ctx, msg)))
        }
        scroll()
      }).then(function(){})
    })

    // Send and display new messages
    container.appendChild(vdom.create(renderInterface(function(er, text) {
      co(function*() {
        if(!text) return
        var msg = {text: text, user: ctx.user.id}
        chat.write(msg)
        messages.appendChild(vdom.create(yield renderChatMessage(ctx, msg)))
        scroll()
      }).then(function(){})
    })))

    function scroll() {
      messages.scrollTop = messages.clientHeight
    }

    next()
  })

  register()
}

function renderHeader(ctx) {
  return h('div.Chat__header', [
    h('div.btn-group.Chat__header__controls', [
      h('a.btn.glyphicon.glyphicon-minus', {
        attributes: {'aria-label':'Minimize chat window'}
      , 'ev-click': function() {
        var Chat = document.querySelector('.Chat')
        Chat.classList.add('Chat--minimized')
        Chat.classList.remove('Chat--small')
        ctx.settings.set('plugin-chat:window', 'minimized')
      }})
    , h('a.btn.glyphicon.glyphicon-resize-full', {
        attributes: {'aria-label':'Resize chat window to full size'}
      , 'ev-click': function() {
        var Chat = document.querySelector('.Chat')
        Chat.classList.remove('Chat--minimized')
        Chat.classList.remove('Chat--small')
        ctx.settings.set('plugin-chat:window', 'full')
      }})
    ])
  , h('h5', [
      h('i.glyphicon.glyphicon-comment')
    , ' Chat '
    , h('small', 'discuss and inspire')
    ])
  ])
}

function renderInterface(cb) {
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
          var input = evt.currentTarget
          cb(null, input.value)
          input.value = ''
        }
      }})
    ]),
    h('input.btn.btn-default.btn-block.hidden-md.hidden-lg', {
      attributes:{type:'submit', value: 'send'}
    , 'ev-click': function(evt) {
        evt.preventDefault()
        var input = evt.currentTarget.previousSibling
        cb(null, input.value)
        input.value = ''
      }
    })
  ])
}

function* renderChatMessage(ctx, msg) {
  return h('div.Chat__Message', {attributes:{'data-user': msg.user}}, [
    h('span.Chat__Message__User', (yield function(cb) {
      ctx.client.user.get(msg.user, cb)
    }).name+': '),
    h('span.Chat__Message__Text', msg.text)
  ])
}


function jsonStringify() {
  return through.obj(function(buf, enc, cb) {
    this.push(JSON.stringify(buf)+'\n')
    cb()
  })
}
