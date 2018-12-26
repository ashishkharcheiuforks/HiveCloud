'use strict';

const functions = require('firebase-functions');
const admin = require('firebase-admin');
admin.initializeApp();

const firestore = admin.firestore();

// This is needed to remove timestamp warning
const settings = {timestampsInSnapshots: true};
firestore.settings(settings);

// === Exports ===

// Listen for new chat messages added to /chatrooms/:chatroomId/messages/:messageId ,
// update corresponding chatroom of the sender and the receiver,
// and send data FCM message to the receiver of the new chat message.
// Note that if the function does not execute for some reason (due to error or server down),
// then chatrooms will NOT be updated. Only next time the function is invoked 
// (when another new message is created). There is nothing we can do about it.
exports.onNewChatMessage = functions.firestore.document('/chatrooms/{chatroomUid}/messages/{messageUid}')
	// This is triggered on new document creation
    .onCreate((snap, context) => {
    	// Get chat message from the document
    	const message = snap.data();

    	// Get sender uid, receiver uid and message text from the chat message
     	const senderUid = message.sender_uid;
     	const receiverUid = message.receiver_uid;
      	const messageText = message.message_text;
      	const messageTimestamp = message.timestamp;
      	const messageTimestampMillis = messageTimestamp.toMillis();

      	console.log(`messageTimestampMillis = ${messageTimestampMillis}`);

        let senderName;
        let senderUserPicUrl;

		// Get sender user
		// (in return statement, because this method must return promise)
  		return firestore
            .collection('users')
            .doc(senderUid)
            .get()
            .then(doc => {
            	// Get sender user from the document
 	   	        const sender = doc.data();

		        // Init sender name with username or name
		        senderName = getUserNameOrUsername(sender.name, sender.username);

		        // Get sender user pic URL
		        senderUserPicUrl = sender.userPicUrl;

		      	// Get receiver user
		      	// (in return statement, because this method must return promise)
		  		return firestore.collection('users').doc(receiverUid).get();
		    })
            .then(doc => {
            	// Get receiver user from the document
 	   	        const receiver = doc.data();

		        // Init receiver name with username or name
		        const receiverName = getUserNameOrUsername(receiver.name, receiver.username);

		        // Get receiver user pic URL
		        const receiverUserPicUrl = receiver.userPicUrl;

				// Get receiver user's FCM token		        	
		        const receiverToken = receiver.fcm_token;

		        // Create promise to send FCM message to the device with specified FCM token.
		        const sendNotificationPromise = getSendNotificationPromise(senderUid, senderName, senderUserPicUrl, messageText, messageTimestampMillis, receiverToken);

		        // Chatrooms are updated inside transactions
		        // to prevent corrupting data by parallel function execution.
				const updateSenderChatroomPromise = getUpdateSenderChatroomOnCreatePromise(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl, messageTimestamp, messageText);
				const updateReceiverChatroomPromise = getUpdateReceiverChatroomOnCreatePromise(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl, messageTimestamp, messageText);

				// Send notification and update sender and receiver chatrooms
				return Promise.all([sendNotificationPromise, updateSenderChatroomPromise, updateReceiverChatroomPromise]);
            });
    });

// -----------------------

// If the message is marked as read, determine current number of unread messages
// and update new message count of the receiver's chatroom with this number.
// Note that if this function is not executed, 
// then the receiver chatroom counter will not be updated
// (only after the sender sends another message, and the receiver receives it).
// There is nothing we can do about it.
exports.onUpdateChatMessage = functions.firestore.document('/chatrooms/{chatroomUid}/messages/{messageUid}')
	// This is triggered on document update
    .onUpdate((change, context) => {
    	// Get old chat message
    	const oldMessage = change.before.data();
    	// Get new chat message
    	const newMessage = change.after.data();

     	const senderUid = newMessage.sender_uid;
     	const receiverUid = newMessage.receiver_uid;

    	if (oldMessage.isRead === true || newMessage.isRead === false) {
    		// If message has not been marked as read during this update,
    		// then do nothing.
    		return null;

    	} else {
    		// Otherwise update receiver chatroom
    		return getUpdateReceiverChatroomOnUpdatePromise(senderUid, receiverUid);
    	}
    });

// -----------------------

// If user's username or userpic has been updated,
// update it in all chatrooms, this user participates in.
exports.onUpdateUserNameAndPic = functions.firestore.document('/userNameAndPic/{userUid}')
	// This is triggered on every document update
    .onUpdate((change, context) => {
    	const oldData = change.before.data();
    	const newData = change.after.data();
    	const userUid = context.params.userUid;

    	// Name used in chatrooms (name or username)
		const oldUsername = getUserNameOrUsername(oldData.name, oldData.username);
    	const newUsername = getUserNameOrUsername(newData.name, newData.username);

		const oldUserPicUrl = oldData.userPicUrl;
    	const newUserPicUrl = newData.userPicUrl;

    	if (oldUsername === newUsername && oldUserPicUrl === newUserPicUrl) {
    		// Username and user pic not changed, do nothing
	    	return null;

    	} else {
    		// Username or user pic changed, update it in the chatrooms of the user
    		return getUserChatroomsAndUpdateUsername(userUid, oldUsername, newUsername, oldUserPicUrl, newUserPicUrl);
    	}
    });

// -----------------------

// On every new review update corresponding offer rating in provider user
// (the user who provides this offer).
exports.onNewReview = functions.firestore.document('/reviews/{offerReviewsDocument}/reviewsOfOffer/{reviewUid}')
	// This is triggered on new review creation
    .onCreate((snap, context) => {
    	// Get review from the document
    	const newReview = snap.data();

    	// Get reviews collection document id from params
    	const offerReviewsDocument = context.params.offerReviewsDocument;

     	const providerUserUid = newReview.providerUserUid;
     	const offerUid = newReview.offerUid;
     	const newReviewRating = newReview.rating;
     	const newReviewAuthorName = newReview.authorName;
     	const newReviewAuthorUserPicUrl = newReview.authorUserPicUrl;
     	const newReviewText = newReview.text;
     	const newReviewTimestamp = newReview.timestamp;

      	let providerUser;

      	const providerUserRef = firestore.collection('users').doc(providerUserUid);

      	// Update provider user offer rating list in transaction
      	// (this is needed, because several reviews on the same offer 
      	// can be posted at the same time)
        return firestore.runTransaction(transaction => {
		    return transaction.get(providerUserRef)
				.then(doc => {
					// Get provider user
	 	   	        providerUser = doc.data();

   	              	// Get offer reviews
	 	   	        return getOfferReviewsPromise(offerReviewsDocument);
		    	})
		    	.then(snapshot => {
		    		// Calculate new offer rating based on all reviews of this offer
   	              	const offerRatings = recalculateOfferRatings(snapshot, newReviewRating, providerUser, offerUid, newReviewAuthorName, newReviewAuthorUserPicUrl, newReviewText, newReviewTimestamp);

   	              	// Update only offer rating array in provider user
					const updatedProviderUser = {
						offerRatingList: offerRatings
					};

					return transaction.update(providerUserRef, updatedProviderUser);
		    	})
		})
		.then(result => {
			return null;
		})
		.catch(err => {
			console.log('Update provider user transaction failure:', err);
			return null;
		});
    });

// === Functions ===

function getUserNameOrUsername(name, userName) {
    return (userName !== undefined && userName !== "") ? userName : name;
}

function getChatroomUid(senderUid, receiverUid) {
    return (senderUid < receiverUid) ? `${senderUid}_${receiverUid}` : `${receiverUid}_${senderUid}`;
}

function getNewMessageCount(tempNewMessageCount) {
	return (tempNewMessageCount !== undefined) ? tempNewMessageCount : 0;
}

function getUserChatroomRef(userUid, chatroomUid) {
	return firestore.collection('userChatrooms').doc(userUid).collection('chatroomsOfUser').doc(chatroomUid);
}

function getUpdatedChatroom(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl) {
	// These properties are updated anyway
	return {
		userUid1: `${senderUid}`,
		userUid2: `${receiverUid}`,
		userName1: `${senderName}`,
		userName2: `${receiverName}`,
		userPicUrl1: `${senderUserPicUrl}`,
		userPicUrl2: `${receiverUserPicUrl}`
	};
}

function updateChatroomLastMessage(chatroom, messageText, messageTimestamp) {
	chatroom["lastMessageText"] = `${messageText}`;
	chatroom["lastMessageTimestamp"] = messageTimestamp;					    		

	return chatroom;
}

function getSendNotificationPromise(senderUid, senderName, senderUserPicUrl, messageText, messageTimestampMillis, receiverToken) {
    // Create FCM message with sender uid and name and message text.
    // We must send DATA FCM message, not notification message
    // (message contains only "data" part).
    // This is because notification messages do not trigger
    // FirebaseMessagingService.onMessageReceived() on the Android device,
    // when the app is in the BACKGROUND, and we need to show 
    // new chat message notification exactly when the app is in the background.
    const payload = {
      data: {
	    senderUid: `${senderUid}`,
	    senderName: `${senderName}`,
	    senderUserPicUrl: `${senderUserPicUrl}`,
        messageText: `${messageText}`,
        messageTimestamp: `${messageTimestampMillis}`
      }
    };

    // Create promise to send FCM message to the device with specified FCM token.
    return admin.messaging().sendToDevice(receiverToken, payload);
}

function getReceiverChatroomUnreadMessagesPromise(chatroomUid, receiverUid) {
    return firestore
    	.collection('chatrooms')
    	.doc(chatroomUid)
    	.collection('messages')
    	.where('isRead', '==', false)
    	.where('receiver_uid', '==', receiverUid)
		.get()
}

function getUpdateSenderChatroomOnCreatePromise(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl, messageTimestamp, messageText) {
    const chatroomUid = getChatroomUid(senderUid, receiverUid);
	const senderChatroomRef = getUserChatroomRef(senderUid, chatroomUid);
	let updatedSenderChatroom = getUpdatedChatroom(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl);

	return firestore.runTransaction(transaction => {
		    return transaction.get(senderChatroomRef)
				.then(doc => {
					// Get sender chatroom
					const senderChatroom = doc.data();

					updatedSenderChatroom = updateChatroomLastMessage(updatedSenderChatroom, messageText, messageTimestamp);

					if (senderChatroom === undefined) {
						// Chatroom does not exist yet.
						// Create it instead of updating.
						return transaction.set(senderChatroomRef, updatedSenderChatroom);

					} else {
						// Get current last message timestamp
						const senderChatroomCurrentLastMessageTimestamp = senderChatroom.lastMessageTimestamp;

						// Update sender chatroom only if this message is newer, 
						// than the last message in the chatroom.
						if (senderChatroomCurrentLastMessageTimestamp === undefined || messageTimestamp.toMillis() > senderChatroomCurrentLastMessageTimestamp.toMillis()) {
							return transaction.update(senderChatroomRef, updatedSenderChatroom);

						} else {
							// Message is older than sender chatroom last message, do not update
							return null;
						}
					}
		    	})
		})
		.then(result => {
			return null;
		})
		.catch(err => {
			console.log('Update sender chatroom transaction failure:', err);
			return null;
		});
}

function getUpdateReceiverChatroomOnCreatePromise(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl, messageTimestamp, messageText) {
    const chatroomUid = getChatroomUid(senderUid, receiverUid);
	const receiverChatroomRef = getUserChatroomRef(receiverUid, chatroomUid);
	let updatedReceiverChatroom = getUpdatedChatroom(senderUid, receiverUid, senderName, receiverName, senderUserPicUrl, receiverUserPicUrl);

	return firestore.runTransaction(transaction => {
			let receiverChatroom;
			let receiverChatroomCurrentLastMessageTimestamp = 0;
			let receiverChatroomCurrentNewMessageCount;

	    	return transaction.get(receiverChatroomRef)
	    		.then(doc => {
					// Get receiver chatroom
					receiverChatroom = doc.data();

					// Get current last message timestamp and new message count
					receiverChatroomCurrentLastMessageTimestamp = receiverChatroom !== undefined ? receiverChatroom.lastMessageTimestamp : undefined;
					receiverChatroomCurrentNewMessageCount = receiverChatroom !== undefined ? receiverChatroom.newMessageCount : 0;

			        // Get receiver's unread chatroom messages
			        return getReceiverChatroomUnreadMessagesPromise(chatroomUid, receiverUid);
		    	})
		    	.then(snapshot => {
					// Count the number of unread chatroom messages
					const unreadMessageCount = snapshot.empty ? 0 : snapshot.size;

			    	let isCountUpdated = false;
			    	let isLastMessageUpdated = false;

				    // New message count in the receiver chatroom must be updated only if it is different
			    	if (unreadMessageCount !== receiverChatroomCurrentNewMessageCount) {
						updatedReceiverChatroom["newMessageCount"] = unreadMessageCount;
						isCountUpdated = true;
			    	}

					// Last message in the receiver chatroom should be updated,
					// only if this message is newer.
			    	if (receiverChatroomCurrentLastMessageTimestamp === undefined || messageTimestamp.toMillis() > receiverChatroomCurrentLastMessageTimestamp.toMillis()) {
						updatedReceiverChatroom = updateChatroomLastMessage(updatedReceiverChatroom, messageText, messageTimestamp);			    		
						isLastMessageUpdated = true;
			    	}

			    	if (receiverChatroom === undefined) {
						// Chatroom does not exist yet.
						// Create it instead of updating.
			    		return transaction.set(receiverChatroomRef, updatedReceiverChatroom);

			    	} else {
				    	if (isCountUpdated || isLastMessageUpdated) {
				    		// If new message count or last message should be updated, 
				    		// then update receiver chatroom.
				    		return transaction.update(receiverChatroomRef, updatedReceiverChatroom);

				    	} else {
				    		// If nothing should be updated, do nothing.
				    		return null;
				    	}
			    	}
		    	})
		})
		.then(result => {
			return null;
		})
		.catch(err => {
			console.log('Update receiver chatroom transaction failure:', err);
			return null;
		});
}

function getUpdateReceiverChatroomOnUpdatePromise(senderUid, receiverUid) {
    const chatroomUid = getChatroomUid(senderUid, receiverUid);
    const receiverChatroomRef = getUserChatroomRef(receiverUid, chatroomUid);

    // Run new message counter update inside the transaction
    // to prevent corrupting data by parallel function execution.
    // Transaction will restart from the beginning, if the data
    // (the receiver's chatroom new message counter)
    // is modified by another function instance execution.
	return firestore.runTransaction(transaction => {
			let currentReceiverNewMessageCount;

		    return transaction.get(receiverChatroomRef)
	    		.then(doc => {
					// Get receiver chatroom from the document
					const receiverChatroom = doc.data();

					currentReceiverNewMessageCount = getNewMessageCount(receiverChatroom.newMessageCount);

					if (currentReceiverNewMessageCount === 0) {
						// Do nothing, if new message count is already 0
						return null;

					} else {
				        // Otherwise get receiver's unread chatroom messages
				        return getReceiverChatroomUnreadMessagesPromise(chatroomUid, receiverUid);
					}
		    	})
				.then(snapshot => {
					if (snapshot !== null) {
						// Count the number of unread chatroom messages
						const unreadMessageCount = snapshot.empty ? 0 : snapshot.size;

				    	if (unreadMessageCount !== currentReceiverNewMessageCount) {
				    		// If the number of unread chatroom messages is different from the current new message count,
					    	// update new message count of the receiver's chatroom with the number of unread messages.
					      	return transaction.update(receiverChatroomRef, {newMessageCount: unreadMessageCount});
				    	
				    	} else {
				    		// Current new message count is already correct, do nothing
				    		return null;
				    	}

				    } else {
				    	// Snapshot is null (because current new message count is already 0 int previous then()),
				    	// do nothing.
				    	return null;
				    }
				})
		})
		.then(result => {
			return null;
		})
		.catch(err => {
			console.log('Transaction failure:', err);
			return null;
		});
}

function getUserChatroomsAndUpdateUsername(userUid, oldUsername, newUsername, oldUserPicUrl, newUserPicUrl) {
	// Get user's chatrooms and update username inside them
	return firestore
		.collection('userChatrooms')
		.doc(userUid)
		.collection('chatroomsOfUser')
		.get()
		.then(snapshot => {
			if (!snapshot.empty) {
				// Update username in chatrooms
				return getUpdateUsernameInChatroomsPromise(snapshot, oldUsername, newUsername, oldUserPicUrl, newUserPicUrl);

    		} else {
    			// No user chatrooms found, do nothing
      			return null;
    		} 
		});
}

function getUpdateUsernameInChatroomsPromise(snapshot, oldUsername, newUsername, oldUserPicUrl, newUserPicUrl) {
    let updateChatroomPromiseArray = [];

    // For all chatrooms of the user
    for (let i = 0; i < snapshot.size; i++) {
        const chatroom = snapshot.docs[i].data();
    	const chatroomUid = snapshot.docs[i].id;
        const userUid1 = chatroom.userUid1;
        const userUid2 = chatroom.userUid2;
        const userName1 = chatroom.userName1;
        const userName2 = chatroom.userName2;
        const userPicUrl1 = chatroom.userPicUrl1;
        const userPicUrl2 = chatroom.userPicUrl2;

        // Second user name is the one that is not equal to OLD name of the user
		const secondUserName = userName1 !== oldUsername ? userName1 : userName2;

        // Second user pic URL is the one that is not equal to OLD user pic URL of the user
		const secondUserPicUrl = userPicUrl1 !== oldUserPicUrl ? userPicUrl1 : userPicUrl2;

		const updatedChatroom = {
			userName1: `${newUsername}`,
			userName2: `${secondUserName}`,
			userPicUrl1: `${newUserPicUrl}`,
			userPicUrl2: `${secondUserPicUrl}`
		};

        // Create promises to change username in the chatroom for BOTH users,
        // that participate in this chatroom.
		updateChatroomPromiseArray.push(getUpdateChatroomForUserPromise(chatroomUid, userUid1, updatedChatroom));
		updateChatroomPromiseArray.push(getUpdateChatroomForUserPromise(chatroomUid, userUid2, updatedChatroom));
    }

    return Promise.all(updateChatroomPromiseArray);
}

function getUpdateChatroomForUserPromise(chatroomUid, userUid, updatedChatroom) {
    const chatroomRef = getUserChatroomRef(userUid, chatroomUid);

	return firestore.runTransaction(transaction => {
		    return transaction.get(chatroomRef)
				.then(doc => {
					return transaction.update(chatroomRef, updatedChatroom);
		    	})
		})
		.then(result => {
			return null;
		})
		.catch(err => {
			console.log('Update username in chatroom transaction failure:', err);
			return null;
		});
}

function getOfferReviewsPromise(offerReviewsDocument) {
    return firestore
    	.collection('reviews')
    	.doc(offerReviewsDocument)
    	.collection('reviewsOfOffer')
		.get()
}

function recalculateOfferRatings(snapshot, newReviewRating, providerUser, offerUid, newReviewAuthorName, newReviewAuthorUserPicUrl, newReviewText, newReviewTimestamp) {
	let newReviewCount = 0;
	let ratingSum = 0;

	if (snapshot.empty) {
		newReviewCount = 1;
		ratingSum = newReviewRating;

	} else {
		newReviewCount = snapshot.size;

		snapshot.forEach(doc => {
			const reviewItem = doc.data();
			ratingSum = ratingSum + reviewItem.rating;
		});
	}

  	// Calculate averate rating
  	const averageRating = ratingSum / newReviewCount;

  	// Get offer rating list
  	let offerRatings = providerUser.offerRatingList;

  	if (offerRatings === undefined) {
  		// If user has no reviews yet, create new offer rating array
  		offerRatings = [];
  	}

  	// Find index of current offer's rating
  	const index = offerRatings.findIndex( item => item.offer_uid === offerUid );

	let offerRating;

  	if (index >= 0 && index < offerRatings.length) {
  		// If current offer's rating exist, update it
      	offerRating = offerRatings[index];

      	offerRating.offer_rating = averageRating;
      	offerRating.offer_review_count = newReviewCount;

      	const currentLastReviewTimestamp = offerRating.offer_last_review_timestamp;

      	// If this review is the first or latest, 
      	// then replace previous review in offer rating with this one.
		if (currentLastReviewTimestamp === undefined || newReviewTimestamp.toMillis() > currentLastReviewTimestamp.toMillis()) {
			offerRating.offer_last_review_author_name = newReviewAuthorName;
			offerRating.offer_last_review_author_pic = newReviewAuthorUserPicUrl;
			offerRating.offer_last_review_text = newReviewText;
			offerRating.offer_last_review_timestamp = newReviewTimestamp;
		}

  	} else {
  		// Otherwise (this is the first review on the current offer)
  		// create new rating and add it to offer rating array.
		offerRating = {
			offer_uid: offerUid,
			offer_rating: averageRating,
			offer_review_count: newReviewCount,
			offer_last_review_author_name: newReviewAuthorName,
			offer_last_review_author_pic: newReviewAuthorUserPicUrl,
			offer_last_review_text: newReviewText,
			offer_last_review_timestamp: newReviewTimestamp
		};

		offerRatings.push(offerRating);
  	}

  	return offerRatings;
}