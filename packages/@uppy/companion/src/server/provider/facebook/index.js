const Provider = require('../Provider')

const request = require('request')
const purest = require('purest')({ request })
const { getURLMeta } = require('../../helpers/request')
const logger = require('../../logger')
const adapter = require('./adapter')
const { ProviderApiError, ProviderAuthError } = require('../error')

/**
 * Adapter for API https://developers.facebook.com/docs/graph-api/using-graph-api/
 */
class Facebook extends Provider {
  constructor (options) {
    super(options)
    this.authProvider = Facebook.authProvider
    this.client = purest({
      ...options,
      provider: Facebook.authProvider,
    })
  }

  static get authProvider () {
    return 'facebook'
  }

  list ({ directory, token, query = { cursor: null } }, done) {
    const qs = {
      fields: 'name,cover_photo,created_time,type',
    }

    if (query.cursor) {
      qs.after = query.cursor
    }

    let path = 'me/albums'
    if (directory) {
      path = `${directory}/photos`
      qs.fields = 'icon,images,name,width,height,created_time'
    }

    this.client
      .get(`https://graph.facebook.com/${path}`)
      .qs(qs)
      .auth(token)
      .request((err, resp, body) => {
        if (err || resp.statusCode !== 200) {
          err = this._error(err, resp)
          logger.error(err, 'provider.facebook.list.error')
          return done(err)
        }
        this._getUsername(token, (err, username) => {
          if (err) {
            done(err)
          } else {
            done(null, this.adaptData(body, username, directory, query))
          }
        })
      })
  }

  _getUsername (token, done) {
    this.client
      .get('me')
      .qs({ fields: 'email' })
      .auth(token)
      .request((err, resp, body) => {
        if (err || resp.statusCode !== 200) {
          err = this._error(err, resp)
          logger.error(err, 'provider.facebook.user.error')
          return done(err)
        }
        done(null, body.email)
      })
  }

  _getMediaUrl (body) {
    const sortedImages = adapter.sortImages(body.images)
    return sortedImages[sortedImages.length - 1].source
  }

  download ({ id, token }, onData) {
    return this.client
      .get(`https://graph.facebook.com/${id}`)
      .qs({ fields: 'images' })
      .auth(token)
      .request((err, resp, body) => {
        if (err || resp.statusCode !== 200) {
          err = this._error(err, resp)
          logger.error(err, 'provider.facebook.download.error')
          onData(err)
          return
        }

        request(this._getMediaUrl(body))
          .on('response', (resp) => {
            if (resp.statusCode !== 200) {
              onData(this._error(null, resp))
            } else {
              resp.on('data', (chunk) => onData(null, chunk))
            }
          })
          .on('end', () => onData(null, null))
          .on('error', (err) => {
            logger.error(err, 'provider.facebook.download.url.error')
            onData(err)
          })
      })
  }

  thumbnail (_, done) {
    // not implementing this because a public thumbnail from facebook will be used instead
    const err = new Error('call to thumbnail is not implemented')
    logger.error(err, 'provider.facebook.thumbnail.error')
    return done(err)
  }

  size ({ id, token }, done) {
    return this.client
      .get(`https://graph.facebook.com/${id}`)
      .qs({ fields: 'images' })
      .auth(token)
      .request((err, resp, body) => {
        if (err || resp.statusCode !== 200) {
          err = this._error(err, resp)
          logger.error(err, 'provider.facebook.size.error')
          return done(err)
        }

        getURLMeta(this._getMediaUrl(body))
          .then(({ size }) => done(null, size))
          .catch((err) => {
            logger.error(err, 'provider.facebook.size.error')
            done()
          })
      })
  }

  logout ({ token }, done) {
    return this.client
      .delete('me/permissions')
      .auth(token)
      .request((err, resp) => {
        if (err || resp.statusCode !== 200) {
          logger.error(err, 'provider.facebook.logout.error')
          done(this._error(err, resp))
          return
        }
        done(null, { revoked: true })
      })
  }

  adaptData (res, username, directory, currentQuery) {
    const data = { username, items: [] }
    const items = adapter.getItemSubList(res)
    items.forEach((item) => {
      data.items.push({
        isFolder: adapter.isFolder(item),
        icon: adapter.getItemIcon(item),
        name: adapter.getItemName(item),
        mimeType: adapter.getMimeType(item),
        size: null,
        id: adapter.getItemId(item),
        thumbnail: adapter.getItemThumbnailUrl(item),
        requestPath: adapter.getItemRequestPath(item),
        modifiedDate: adapter.getItemModifiedDate(item),
      })
    })

    data.nextPagePath = adapter.getNextPagePath(res, currentQuery, directory)
    return data
  }

  _error (err, resp) {
    if (resp) {
      if (resp.body && resp.body.error.code === 190) {
        // Invalid OAuth 2.0 Access Token
        return new ProviderAuthError()
      }

      const fallbackMessage = `request to ${this.authProvider} returned ${resp.statusCode}`
      const msg = resp.body && resp.body.error ? resp.body.error.message : fallbackMessage
      return new ProviderApiError(msg, resp.statusCode)
    }

    return err
  }
}

module.exports = Facebook
