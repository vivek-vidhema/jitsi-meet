/* @flow */

import Logger from 'jitsi-meet-logger';
import { CONFERENCE_WILL_JOIN } from '../base/conference';
import {
    SIP_GW_AVAILABILITY_CHANGED,
    SIP_GW_INVITE_ROOMS
} from './actionTypes';
import {
    JitsiConferenceEvents,
    JitsiSIPVideoGWStatus
} from '../base/lib-jitsi-meet';
import { MiddlewareRegistry } from '../base/redux';
import {
    Notification,
    showErrorNotification,
    showNotification,
    showWarningNotification
} from '../notifications';

const logger = Logger.getLogger(__filename);

/**
 * Middleware that captures conference video sip gw events and stores
 * the global sip gw availability in redux or show appropriate notification
 * for sip gw sessions.
 * Captures invitation actions that create sip gw sessions or display
 * appropriate error/warning notifications.
 *
 * @param {Store} store - The redux store.
 * @returns {Function}
 */
MiddlewareRegistry.register(({ dispatch, getState }) => next => action => {
    const result = next(action);

    switch (action.type) {
    case CONFERENCE_WILL_JOIN: {
        const conference = getState()['features/base/conference'].joining;

        conference.on(
            JitsiConferenceEvents.VIDEO_SIP_GW_AVAILABILITY_CHANGED,
            (...args) => dispatch(_availabilityChanged(...args)));
        conference.on(
            JitsiConferenceEvents.VIDEO_SIP_GW_SESSION_STATE_CHANGED,
            event => {
                const toDispatch = _sessionStateChanged(event);

                // sessionStateChanged can decide there is nothing to dispatch
                if (toDispatch) {
                    dispatch(toDispatch);
                }
            });

        break;
    }
    case SIP_GW_INVITE_ROOMS: {
        const { status } = getState()['features/videosipgw'];

        if (status === JitsiSIPVideoGWStatus.STATUS_UNDEFINED) {
            dispatch(showErrorNotification({
                descriptionKey: 'recording.unavailable',
                descriptionArguments: {
                    serviceName: '$t(videoSIPGW.serviceName)'
                },
                titleKey: 'videoSIPGW.unavailableTitle'
            }));

            return;
        } else if (status === JitsiSIPVideoGWStatus.STATUS_BUSY) {
            dispatch(showWarningNotification({
                descriptionKey: 'videoSIPGW.busy',
                titleKey: 'videoSIPGW.busyTitle'
            }));

            return;
        } else if (status !== JitsiSIPVideoGWStatus.STATUS_AVAILABLE) {
            logger.error(`Unknown sip videogw status ${status}`);

            return;
        }

        for (const room of action.rooms) {
            const { id: sipAddress, name: displayName } = room;

            if (sipAddress && displayName) {
                const newSession = action.conference
                    .createVideoSIPGWSession(sipAddress, displayName);

                if (newSession instanceof Error) {
                    const e = newSession;

                    if (e) {
                        switch (e.message) {
                        case JitsiSIPVideoGWStatus.ERROR_NO_CONNECTION: {
                            dispatch(showErrorNotification({
                                descriptionKey: 'videoSIPGW.errorInvite',
                                titleKey: 'videoSIPGW.errorInviteTitle'
                            }));

                            return;
                        }
                        case JitsiSIPVideoGWStatus.ERROR_SESSION_EXISTS: {
                            dispatch(showWarningNotification({
                                titleKey: 'videoSIPGW.errorAlreadyInvited',
                                titleArguments: { displayName }
                            }));

                            return;
                        }
                        }
                    }
                    logger.error(
                        'Unknown error trying to create sip videogw session',
                        e);

                    return;
                }

                newSession.start();
            } else {
                logger.error(`No display name or sip number for ${
                    JSON.stringify(room)}`);
            }
        }
    }
    }

    return result;
});

/**
 * Signals that sip gw availability had changed.
 *
 * @param {string} status - The new status of the service.
 * @returns {{
 *     type: SIP_GW_AVAILABILITY_CHANGED,
 *     status: string
 * }}
 * @private
 */
function _availabilityChanged(status: string) {
    return {
        type: SIP_GW_AVAILABILITY_CHANGED,
        status
    };
}

/**
 * Signals that a session we created has a change in its status.
 *
 * @param {string} event - The event describing the session state change.
 * @returns {{
 *     type: SHOW_NOTIFICATION
 * }}|null
 * @private
 */
function _sessionStateChanged(
        event: Object) {
    switch (event.newState) {
    case JitsiSIPVideoGWStatus.STATE_PENDING: {
        return showNotification(
            Notification, {
                titleKey: 'videoSIPGW.pending',
                titleArguments: {
                    displayName: event.displayName
                }
            }, 2000);
    }
    case JitsiSIPVideoGWStatus.STATE_FAILED: {
        return showErrorNotification({
            titleKey: 'videoSIPGW.errorInviteFailedTitle',
            titleArguments: {
                displayName: event.displayName
            },
            descriptionKey: 'videoSIPGW.errorInviteFailed'
        });
    }
    }

    // nothing to show
    return null;
}
