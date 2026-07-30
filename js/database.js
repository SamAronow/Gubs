/* Firebase Realtime Database helpers.
   Note: the original file ended with  write("/","HI")  which overwrites the
   entire database root on every page load. That line is gone. */

const firebaseConfig = {
  apiKey: "AIzaSyDBS0D8mapvya_wFMwVo_oIZL3lN31y5eg",
  authDomain: "gubs-80fbf.firebaseapp.com",
  databaseURL: "https://gubs-80fbf-default-rtdb.firebaseio.com",
  projectId: "gubs-80fbf",
  storageBucket: "gubs-80fbf.firebasestorage.app",
  messagingSenderId: "559234627020",
  appId: "1:559234627020:web:87e1969d5e1643100a1969",
  measurementId: "G-R354K96NW3"
};

firebase.initializeApp(firebaseConfig);
var database = firebase.database();

function write(path,value){
    database.ref(path).set(value, function(error) {
        if (error) {
          console.error("Error updating count:", error);
        } else {
          console.log("Data updated successfully!");
        }
      });
}

function read(path) {
return database.ref(path).once('value')
  .then(function(snapshot) {
    //console.log(snapshot.val());
    return snapshot.val();
  })
  .catch(function(error) {
    console.error("Error reading Data:", error);
  });
}

function removeNode(path){
database.ref(path).remove()
.then(() => {
console.log("Node deleted successfully!");
})
.catch((error) => {
console.error("Error deleting node:", error);
});
}

/* ---------------------------------------------------------------
   Additional helpers used by rummy.html.
   These are additive only - the three functions above are untouched.
--------------------------------------------------------------- */

// Promise-based set(), so callers can await a write completing.
function writeAsync(path, value){
  return database.ref(path).set(value);
}

// Partial / multi-path update. Value can use slash-separated keys
// (e.g. {'hands/p1': [...]}) to touch several nodes atomically.
function updateAsync(path, values){
  return database.ref(path).update(values);
}

// Subscribe to live changes on a path. Returns an unsubscribe function.
function listen(path, callback){
  const ref = database.ref(path);
  const handler = function(snapshot){ callback(snapshot.val()); };
  ref.on('value', handler);
  return function unsubscribe(){ ref.off('value', handler); };
}

// One-time read that resolves to null instead of throwing if missing.
function readOnce(path){
  return database.ref(path).once('value').then(snap => snap.val());
}