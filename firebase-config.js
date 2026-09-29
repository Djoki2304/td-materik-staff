/* Конфигурация проекта Firebase (materic-id). apiKey не секретен — доступ разграничивается
   правилами Firestore (см. td-materik-employee/firestore.rules), а не этим ключом. */
const firebaseConfig = {
  projectId: "materic-id",
  appId: "1:752688427389:web:c6bfc7b1bfe808e5345c14",
  storageBucket: "materic-id.firebasestorage.app",
  apiKey: "AIzaSyBanj1sH_u-oPn7Osdh2yZAo6e5FS67kMc",
  authDomain: "materic-id.firebaseapp.com",
  messagingSenderId: "752688427389",
  measurementId: "G-C3PNDQTHMJ"
};
firebase.initializeApp(firebaseConfig);
// Второй экземпляр — чтобы создание/смена входа сотрудника не обрывала сессию администратора.
const secondaryApp = firebase.initializeApp(firebaseConfig, "Secondary");
