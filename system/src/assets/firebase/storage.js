import { storage } from "./config";
import { ref, uploadBytes, getDownloadURL, deleteObject } from "firebase/storage";

// 🔹 Generate unique file name
const generateFileName = (file) => {
  const timestamp = Date.now();
  const random = Math.floor(Math.random() * 100000);
  return `${timestamp}_${random}_${file.name}`;
};

// ✅ Upload SINGLE image
export const uploadImage = async (file, folder = "recipes") => {
  try {
    const fileName = generateFileName(file);
    const storageRef = ref(storage, `${folder}/${fileName}`);

    const snapshot = await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(snapshot.ref);

    return downloadURL;
  } catch (error) {
    console.error("Upload image error:", error);
    throw error;
  }
};

// ✅ Upload MULTIPLE images
export const uploadMultipleImages = async (files, folder = "recipes") => {
  try {
    const uploadPromises = Array.from(files).map(async (file) => {
      const fileName = generateFileName(file);
      const storageRef = ref(storage, `${folder}/${fileName}`);

      const snapshot = await uploadBytes(storageRef, file);
      return await getDownloadURL(snapshot.ref);
    });

    const urls = await Promise.all(uploadPromises);
    return urls;
  } catch (error) {
    console.error("Upload multiple images error:", error);
    throw error;
  }
};

// ✅ DELETE SINGLE image using URL
export const deleteImage = async (imageUrl) => {
  try {
    const imageRef = ref(storage, imageUrl); // 🔥 works directly with full URL
    await deleteObject(imageRef);
  } catch (error) {
    console.error("Delete image error:", error);
    throw error;
  }
};

// ✅ DELETE MULTIPLE images
export const deleteMultipleImages = async (imageUrls) => {
  try {
    const deletePromises = imageUrls.map((url) => {
      const imageRef = ref(storage, url);
      return deleteObject(imageRef);
    });

    await Promise.all(deletePromises);
  } catch (error) {
    console.error("Delete multiple images error:", error);
    throw error;
  }
};