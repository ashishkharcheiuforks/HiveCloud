'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

// Listens for new messages added to /chatrooms/:chatroomId/messages/:messageId
exports.sendMessageNotification = functions.firestore.document('/chatrooms/{chatroomUid}/messages/{messageUid}')
    .onCreate((message, context) => {
      const chatroomUid = context.params.chatroomUid;
      const messageUid = context.params.messageUid;

      console.log('Message', chatroomUid, messageUid);


      // // Grab the current value of what was written to the Realtime Database.
      // const original = snap.data().original;
      // console.log('Uppercasing', context.params.documentId, original);
      // const uppercase = original.toUpperCase();
      // // You must return a Promise when performing asynchronous tasks inside a Functions such as
      // // writing to the Firebase Realtime Database.
      // // Setting an 'uppercase' sibling in the Realtime Database returns a Promise.
      // return snap.ref.set({uppercase}, {merge: true});
    });

/**
 * Triggers when a user gets a new follower and sends a notification.
 *
 * Followers add a flag to `/followers/{followedUid}/{followerUid}`.
 * Users save their device notification tokens to `/users/{followedUid}/notificationTokens/{notificationToken}`.
 */
// exports.sendFollowerNotification = functions.database.ref('/followers/{followedUid}/{followerUid}')
//     .onWrite(async (change, context) => {
//       const followerUid = context.params.followerUid;
//       const followedUid = context.params.followedUid;
//       // If un-follow we exit the function.
//       if (!change.after.val()) {
//         return console.log('User ', followerUid, 'un-followed user', followedUid);
//       }
//       console.log('We have a new follower UID:', followerUid, 'for user:', followedUid);

//       // Get the list of device notification tokens.
//       const getDeviceTokensPromise = admin.database()
//           .ref(`/users/${followedUid}/notificationTokens`).once('value');

//       // Get the follower profile.
//       const getFollowerProfilePromise = admin.auth().getUser(followerUid);

//       // The snapshot to the user's tokens.
//       let tokensSnapshot;

//       // The array containing all the user's tokens.
//       let tokens;

//       const results = await Promise.all([getDeviceTokensPromise, getFollowerProfilePromise]);
//       tokensSnapshot = results[0];
//       const follower = results[1];

//       // Check if there are any device tokens.
//       if (!tokensSnapshot.hasChildren()) {
//         return console.log('There are no notification tokens to send to.');
//       }
//       console.log('There are', tokensSnapshot.numChildren(), 'tokens to send notifications to.');
//       console.log('Fetched follower profile', follower);

//       // Notification details.
//       const payload = {
//         notification: {
//           title: 'You have a new follower!',
//           body: `${follower.displayName} is now following you.`,
//           icon: follower.photoURL
//         }
//       };

//       // Listing all tokens as an array.
//       tokens = Object.keys(tokensSnapshot.val());
//       // Send notifications to all tokens.
//       const response = await admin.messaging().sendToDevice(tokens, payload);
//       // For each message check if there was an error.
//       const tokensToRemove = [];
//       response.results.forEach((result, index) => {
//         const error = result.error;
//         if (error) {
//           console.error('Failure sending notification to', tokens[index], error);
//           // Cleanup the tokens who are not registered anymore.
//           if (error.code === 'messaging/invalid-registration-token' ||
//               error.code === 'messaging/registration-token-not-registered') {
//             tokensToRemove.push(tokensSnapshot.ref.child(tokens[index]).remove());
//           }
//         }
//       });
//       return Promise.all(tokensToRemove);
//     });