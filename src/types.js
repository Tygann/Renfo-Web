// @ts-check

/**
 * Festival record used by the UI after enrichment.
 * @typedef {Object} Festival
 * @property {string|number} id
 * @property {string=} name
 * @property {string=} city
 * @property {string=} state
 * @property {string=} stateName
 * @property {string=} abbreviation
 * @property {string=} status
 * @property {number=} daysUntilStart
 * @property {number} lat
 * @property {number} lng
 * @property {number=} latitude
 * @property {number=} longitude
 * @property {string=} subtitle
 * @property {string=} logoAssetUrl
 * @property {string=} mapAssetUrl
 * @property {string=} campAssetUrl
 * @property {string=} dateBegin
 * @property {string=} dateEnd
 * @property {string=} startDate
 * @property {string=} endDate
 * @property {string=} timeBegin
 * @property {string=} timeEnd
 * @property {string=} address
 * @property {string=} zip
 * @property {string=} description
 * @property {string=} modified
 * @property {string|number=} attendance
 * @property {string|number=} established
 * @property {string=} website
 * @property {string=} tickets
 * @property {string=} lostAndFound
 * @property {string=} phone
 * @property {string=} facebook
 * @property {string=} instagram
 * @property {string=} x
 * @property {string=} youtube
 * @property {boolean=} discontinued
 */

/**
 * @typedef {Object} WeatherDay
 * @property {string} dayLabel
 * @property {string} icon
 * @property {string} tempHigh
 * @property {string} tempLow
 */

/**
 * @typedef {Object} WeatherForecast
 * @property {unknown} current
 * @property {WeatherDay[]} days
 */

export {};
