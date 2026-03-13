// import { authenticate } from "../shopify.server";

// export async function action({ request }) {
//   try {
//     // =======================
//     // 1. Read form data
//     // =======================
//     const formData = await request.formData();

//     const metaobjectId = formData.get("id"); // ID for update
//     const brandName = formData.get("brand_name");
//     const bio = formData.get("bio");
//     const category = formData.get("category");
//     const phone = formData.get("phone");
//     const email = formData.get("contact_email");

//     const lookbookFile = formData.get("lookbook_file");
//     const linesheetPdf = formData.get("linesheet_pdf");

//     console.log('*****************STEP1*******************');
//     console.log('Metaobject ID received:', metaobjectId);
//     console.log('Phone:', phone);

//     if (!brandName) {
//       return { success: false, error: "Brand name is required" };
//     }

//     // =======================
//     // 2. Authenticate via App Proxy
//     // =======================
//     const { admin, session } = await authenticate.public.appProxy(request);
//     if (!admin || !session) {
//       return {
//         success: false,
//         error:
//           "App proxy request is authenticated, but no app session exists for this shop. Reinstall/re-auth the app.",
//       };
//     }

//     // =======================
//     // 3. Shopify GraphQL helper
//     // =======================
//     const shopifyGraphQL = async (query, variables) => {
//       const res = await admin.graphql(query, { variables });
//       const json = await res.json();
//       console.log('******************GraphQL Response*******************');
//       console.log(json);

//       if (json.errors?.length) {
//         console.error("GraphQL Error:", json.errors);
//         throw new Error(JSON.stringify(json.errors));
//       }
//       return json.data;
//     };

//     // =======================
//     // 4. Ensure metaobject definition exists
//     // =======================
//     const ensureMetaobjectDefinition = async () => {
//       const checkQuery = `
//         query {
//           metaobjectDefinitions(first: 250) {
//             nodes { type }
//           }
//         }
//       `;

//       const data = await shopifyGraphQL(checkQuery);
//       const exists = data.metaobjectDefinitions.nodes.some(
//         d => d.type === "brand_configurator"
//       );

//       if (exists) return;

//       const createMutation = `
//         mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
//           metaobjectDefinitionCreate(definition: $definition) {
//             userErrors { message }
//           }
//         }
//       `;

//       const definition = {
//         name: "Brand Configurator",
//         type: "brand_configurator",
//         fieldDefinitions: [
//           { name: "Brand Name", key: "brand_name", type: "single_line_text_field", required: true },
//           { name: "Bio", key: "bio", type: "single_line_text_field" },
//           { name: "Category", key: "category", type: "single_line_text_field" },
//           { name: "Phone", key: "phone", type: "single_line_text_field" },
//           { name: "Contact email", key: "contact_email", type: "single_line_text_field" },
//           { name: "Lookbook File", key: "lookbook_file", type: "file_reference" },
//           { name: "Linesheet PDF", key: "linesheet_pdf", type: "file_reference" }
//         ]
//       };

//       const res = await shopifyGraphQL(createMutation, { definition });
//       if (res.metaobjectDefinitionCreate.userErrors.length) {
//         throw new Error("Metaobject definition creation failed");
//       }
//     };

//     await ensureMetaobjectDefinition();

//     // =======================
//     // 5. File upload helpers
//     // =======================
//     const stagedUpload = async (file) => {
//       const query = `
//         mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
//           stagedUploadsCreate(input: $input) {
//             stagedTargets {
//               url
//               resourceUrl
//               parameters { name value }
//             }
//             userErrors { message }
//           }
//         }
//       `;

//       const data = await shopifyGraphQL(query, {
//         input: [{
//           filename: file.name,
//           mimeType: file.type || "application/octet-stream",
//           fileSize: file.size.toString(),
//           resource: "FILE",
//           httpMethod: "POST"
//         }]
//       });

//       if (data.stagedUploadsCreate.userErrors.length) {
//         throw new Error(data.stagedUploadsCreate.userErrors[0].message);
//       }

//       return data.stagedUploadsCreate.stagedTargets[0];
//     };

//     const uploadToS3 = async (target, file) => {
//       const s3Form = new FormData();

//       for (const param of target.parameters) {
//         s3Form.append(param.name, param.value);
//       }

//       s3Form.append("file", file);

//       const res = await fetch(target.url, {
//         method: "POST",
//         body: s3Form
//       });

//       if (!res.ok) {
//         const text = await res.text();
//         console.error("S3 ERROR RESPONSE:", text);
//         throw new Error("S3 upload failed");
//       }
//     };

//     const createShopifyFile = async (resourceUrl) => {
//       const query = `
//         mutation fileCreate($files: [FileCreateInput!]!) {
//           fileCreate(files: $files) {
//             files { id }
//             userErrors { message }
//           }
//         }
//       `;

//       const data = await shopifyGraphQL(query, {
//         files: [{ originalSource: resourceUrl }]
//       });

//       if (data.fileCreate.userErrors.length) {
//         throw new Error(data.fileCreate.userErrors[0].message);
//       }

//       return data.fileCreate.files[0].id;
//     };

//     // =======================
//     // 6. Upload files if provided
//     // =======================
//     let lookbookFileId = null;
//     if (lookbookFile && lookbookFile.size > 0) {
//       const target = await stagedUpload(lookbookFile);
//       await uploadToS3(target, lookbookFile);
//       lookbookFileId = await createShopifyFile(target.resourceUrl);
//     }

//     let linesheetFileId = null;
//     if (linesheetPdf && linesheetPdf.size > 0) {
//       const target = await stagedUpload(linesheetPdf);
//       await uploadToS3(target, linesheetPdf);
//       linesheetFileId = await createShopifyFile(target.resourceUrl);
//     }

//     // =======================
//     // 7. UPDATE or CREATE metaobject
//     // =======================
//     if (metaobjectId && metaobjectId.trim() !== "") {
//       // UPDATE EXISTING METAOBJECT
//       console.log('*****************UPDATING METAOBJECT*******************');
//       console.log('ID:', metaobjectId);

//       const fields = [
//         { key: "brand_name", value: brandName },
//         { key: "bio", value: bio || "" },
//         { key: "category", value: category || "" },
//         { key: "phone", value: phone || "" },
//         { key: "contact_email", value: email || "" }
//       ];

//       if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
//       if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

//       const updateMutation = `
//         mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
//           metaobjectUpdate(
//             id: $id
//             metaobject: { fields: $fields }
//           ) {
//             metaobject { id handle fields { key value } }
//             userErrors { field message }
//           }
//         }
//       `;

//       const fullId = metaobjectId.startsWith('gid://')
//         ? metaobjectId
//         : `gid://shopify/Metaobject/${metaobjectId}`;

//       console.log('Full GID:', fullId);

//       const updateData = await shopifyGraphQL(updateMutation, {
//         id: fullId,
//         fields
//       });

//       if (updateData.metaobjectUpdate.userErrors.length) {
//         console.error('Update errors:', updateData.metaobjectUpdate.userErrors);
//         throw new Error(updateData.metaobjectUpdate.userErrors[0].message);
//       }

//       console.log('*****************UPDATE SUCCESSFUL*******************');
//       return {
//         success: true,
//         action: "update",
//         metaobject: updateData.metaobjectUpdate.metaobject
//       };

//     } else {
//       // CREATE NEW METAOBJECT
//       console.log('*****************CREATING NEW METAOBJECT*******************');

//       const handle = `${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;

//       const fields = [
//         { key: "brand_name", value: brandName },
//         { key: "bio", value: bio || "" },
//         { key: "category", value: category || "" },
//         { key: "phone", value: phone || "" },
//         { key: "contact_email", value: email || "" }
//       ];

//       if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
//       if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

//       const createMutation = `
//         mutation CreateMetaobject($handle: String!, $type: String!, $fields: [MetaobjectFieldInput!]!) {
//           metaobjectCreate(
//             metaobject: { handle: $handle, type: $type, fields: $fields }
//           ) {
//             metaobject { id }
//             userErrors { message }
//           }
//         }
//       `;

//       const createData = await shopifyGraphQL(createMutation, {
//         handle,
//         type: "brand_configurator",
//         fields
//       });

//       if (createData.metaobjectCreate.userErrors.length) {
//         throw new Error(createData.metaobjectCreate.userErrors[0].message);
//       }

//       console.log('*****************CREATE SUCCESSFUL*******************');
//       return {
//         success: true,
//         action: "create",
//         metaobjectId: createData.metaobjectCreate.metaobject.id
//       };
//     }

//   } catch (error) {
//     console.error('*****************ERROR*******************');
//     console.error(error);
//     return { success: false, error: error.message };
//   }
// }



// import { authenticate } from "../shopify.server";

// export async function action({ request }) {
//   try {
//     const formData = await request.formData();

//     const brandId = formData.get("brand_id");
//     const brandName = formData.get("brand_name");  // ✅ ADD THIS
//     const email = formData.get("email");           // ✅ ADD THIS
//     const title = formData.get("title");
//     const price = formData.get("price");
//     const imageFile = formData.get("image");

//     console.log('=== PRODUCT CREATION STARTED ===');
//     console.log('Brand ID:', brandId);
//     console.log('Brand Name:', brandName);         // ✅ LOG THIS
//     console.log('Email:', email);                  // ✅ LOG THIS
//     console.log('Title:', title);
//     console.log('Price:', price);

//     if (!title || !price || !brandId) {
//       return { success: false, error: "Title, price, and brand are required" };
//     }

//     // Authenticate
//     const { admin, session } = await authenticate.public.appProxy(request);
//     if (!admin || !session) {
//       return { success: false, error: "Authentication failed" };
//     }

//     const shopifyGraphQL = async (query, variables) => {
//       const res = await admin.graphql(query, { variables });
//       const json = await res.json();

//       if (json.errors?.length) {
//         console.error("GraphQL Error:", json.errors);
//         throw new Error(json.errors[0].message);
//       }
//       return json.data;
//     };

//     // ========== STEP 1: Create Product with Vendor & Tags ==========
//     console.log('Creating product...');

//     const createProductMutation = `
//       mutation productCreate($input: ProductInput!) {
//         productCreate(input: $input) {
//           product {
//             id
//             title
//             vendor
//             tags
//             status
//           }
//           userErrors {
//             field
//             message
//           }
//         }
//       }
//     `;

//     const productData = await shopifyGraphQL(createProductMutation, {
//       input: {
//         title: title,
//         vendor: brandName || "Unknown",     // ✅ ADD VENDOR
//         tags: email ? [email] : [],         // ✅ ADD TAGS
//         status: "DRAFT"                     // ✅ DRAFT MODE
//       }
//     });

//     if (productData.productCreate.userErrors.length) {
//       throw new Error(productData.productCreate.userErrors[0].message);
//     }

//     const productId = productData.productCreate.product.id;
//     console.log('✓ Product created:', productId);
//     console.log('✓ Vendor:', productData.productCreate.product.vendor);
//     console.log('✓ Tags:', productData.productCreate.product.tags);
//     console.log('✓ Status:', productData.productCreate.product.status);

//     // ========== STEP 2: Create Variant with Price ==========
//     console.log('Creating variant with price...');

//     const createVariantMutation = `
//       mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
//         productVariantsBulkCreate(productId: $productId, variants: $variants) {
//           productVariants {
//             id
//             price
//           }
//           userErrors {
//             field
//             message
//           }
//         }
//       }
//     `;

//     const variantData = await shopifyGraphQL(createVariantMutation, {
//       productId: productId,
//       variants: [{
//         price: price.toString()
//       }]
//     });

//     if (variantData.productVariantsBulkCreate.userErrors.length) {
//       console.error('Variant error:', variantData.productVariantsBulkCreate.userErrors);
//     } else {
//       console.log('✓ Variant created with price:', price);
//     }

//     // ========== STEP 3: Upload Image (if provided) ==========
//     if (imageFile && imageFile.size > 0) {
//       console.log('Uploading image...');

//       try {
//         // 3a. Stage Upload
//         const stagedQuery = `
//           mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
//             stagedUploadsCreate(input: $input) {
//               stagedTargets {
//                 url
//                 resourceUrl
//                 parameters { name value }
//               }
//               userErrors { message }
//             }
//           }
//         `;

//         const stagedData = await shopifyGraphQL(stagedQuery, {
//           input: [{
//             filename: imageFile.name,
//             mimeType: imageFile.type,
//             fileSize: imageFile.size.toString(),
//             resource: "PRODUCT_IMAGE",
//             httpMethod: "POST"
//           }]
//         });

//         if (stagedData.stagedUploadsCreate.userErrors.length) {
//           throw new Error(stagedData.stagedUploadsCreate.userErrors[0].message);
//         }

//         const target = stagedData.stagedUploadsCreate.stagedTargets[0];
//         console.log('✓ Upload staged');

//         // 3b. Upload to S3
//         const s3Form = new FormData();
//         for (const param of target.parameters) {
//           s3Form.append(param.name, param.value);
//         }
//         s3Form.append("file", imageFile);

//         const s3Res = await fetch(target.url, {
//           method: "POST",
//           body: s3Form
//         });

//         if (!s3Res.ok) {
//           throw new Error("S3 upload failed");
//         }
//         console.log('✓ Uploaded to S3');

//         // 3c. Attach to Product
//         const attachImageMutation = `
//           mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
//             productCreateMedia(productId: $productId, media: $media) {
//               media {
//                 id
//                 alt
//               }
//               mediaUserErrors {
//                 field
//                 message
//               }
//             }
//           }
//         `;

//         const mediaData = await shopifyGraphQL(attachImageMutation, {
//           productId: productId,
//           media: [{
//             originalSource: target.resourceUrl,
//             mediaContentType: "IMAGE"
//           }]
//         });

//         if (mediaData.productCreateMedia.mediaUserErrors.length) {
//           console.error('Media error:', mediaData.productCreateMedia.mediaUserErrors);
//         } else {
//           console.log('✓ Image attached to product');
//         }

//       } catch (imgError) {
//         console.error('Image upload error:', imgError);
//         // Don't fail - product is created
//       }
//     }

//     // ========== STEP 4: Add Brand Reference Metafield ==========
//     console.log('Adding brand reference...');

//     const metafieldMutation = `
//       mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
//         metafieldsSet(metafields: $metafields) {
//           metafields {
//             id
//             key
//             value
//           }
//           userErrors {
//             field
//             message
//           }
//         }
//       }
//     `;

//     try {
//       const metafieldData = await shopifyGraphQL(metafieldMutation, {
//         metafields: [{
//           ownerId: productId,
//           namespace: "custom",
//           key: "brand_reference",
//           value: brandId,
//           type: "single_line_text_field"
//         }]
//       });

//       if (metafieldData.metafieldsSet.userErrors.length) {
//         console.error('Metafield error:', metafieldData.metafieldsSet.userErrors);
//       } else {
//         console.log('✓ Brand reference added');
//       }
//     } catch (metaError) {
//       console.error('Metafield error:', metaError);
//     }

//     console.log('=== PRODUCT CREATION COMPLETED ===');

//     return {
//       success: true,
//       productId: productId,
//       message: "Product created successfully!"
//     };

//   } catch (error) {
//     console.error('=== PRODUCT CREATION FAILED ===');
//     console.error(error);
//     return {
//       success: false,
//       error: error.message || "Product creation failed"
//     };
//   }
// }



// all code one script working like craete edit and prduct create


import { authenticate } from "../shopify.server";


export async function action({ request }) {
  try {
    const formData = await request.formData();

    // =======================
    // BRAND METAOBJECT DATA
    // =======================
    const metaobjectId = formData.get("id"); // ID for update
    const brandId = formData.get("brand_id"); // for product reference
    const brandName = formData.get("brand_name");
    const bio = formData.get("bio");
    const category = formData.get("category");
    const phone = formData.get("phone");
    const email = formData.get("contact_email");

    const lookbookFile = formData.get("lookbook_file");
    const linesheetPdf = formData.get("linesheet_pdf");

    // =======================
    // PRODUCT DATA
    // =======================
    const title = formData.get("title");
    const price = formData.get("price");
    const imageFile = formData.get("image");

    console.log('*********** FORM DATA RECEIVED ***********');
    console.log('Brand ID:', brandId, 'Brand Name:', brandName, 'Email:', email);
    console.log('Metaobject ID:', metaobjectId);
    console.log('Product Title:', title, 'Price:', price);

    if (!brandName) {
      return { success: false, error: "Brand name is required" };
    }

    // =======================
    // AUTHENTICATE
    // =======================
    const { admin, session } = await authenticate.public.appProxy(request);
    if (!admin || !session) {
      return { success: false, error: "Authentication failed" };
    }

    const shopifyGraphQL = async (query, variables) => {
      const res = await admin.graphql(query, { variables });
      const json = await res.json();
      if (json.errors?.length) {
        console.error("GraphQL Error:", json.errors);
        throw new Error(JSON.stringify(json.errors));
      }
      return json.data;
    };

    // =======================
    // 1. ENSURE BRAND METAOBJECT DEFINITION
    // =======================
    const ensureMetaobjectDefinition = async () => {
      const checkQuery = `
        query {
          metaobjectDefinitions(first: 250) {
            nodes { type }
          }
        }
      `;
      const data = await shopifyGraphQL(checkQuery);
      const exists = data.metaobjectDefinitions.nodes.some(d => d.type === "brand_configurator");
      if (exists) return;

      const createMutation = `
        mutation CreateMetaobjectDefinition($definition: MetaobjectDefinitionCreateInput!) {
          metaobjectDefinitionCreate(definition: $definition) {
            userErrors { message }
          }
        }
      `;

      const definition = {
        name: "Brand Configurator",
        type: "brand_configurator",
        fieldDefinitions: [
          
          { name: "Brand Name", key: "brand_name", type: "single_line_text_field", required: true },
          { name: "Bio", key: "bio", type: "single_line_text_field" },
          { name: "Category", key: "category", type: "single_line_text_field" },
          { name: "Phone", key: "phone", type: "single_line_text_field" },
          { name: "Contact email", key: "contact_email", type: "single_line_text_field" },
          { name: "Lookbook File", key: "lookbook_file", type: "file_reference" },
          { name: "Linesheet PDF", key: "linesheet_pdf", type: "file_reference" }
        ]
      };

      const res = await shopifyGraphQL(createMutation, { definition });
      if (res.metaobjectDefinitionCreate.userErrors.length) {
        throw new Error("Metaobject definition creation failed");
      }
    };

    await ensureMetaobjectDefinition();

    // =======================
    // 2. FILE UPLOAD HELPERS
    // =======================
    const stagedUpload = async (file, resource = "FILE") => {
      const query = `
        mutation stagedUploadsCreate($input: [StagedUploadInput!]!) {
          stagedUploadsCreate(input: $input) {
            stagedTargets { url resourceUrl parameters { name value } }
            userErrors { message }
          }
        }
      `;
      const data = await shopifyGraphQL(query, {
        input: [{ filename: file.name, mimeType: file.type || "application/octet-stream", fileSize: file.size.toString(), resource, httpMethod: "POST" }]
      });
      if (data.stagedUploadsCreate.userErrors.length) throw new Error(data.stagedUploadsCreate.userErrors[0].message);
      return data.stagedUploadsCreate.stagedTargets[0];
    };

    const uploadToS3 = async (target, file) => {
      const s3Form = new FormData();
      for (const param of target.parameters) s3Form.append(param.name, param.value);
      s3Form.append("file", file);
      const res = await fetch(target.url, { method: "POST", body: s3Form });
      if (!res.ok) throw new Error("S3 upload failed");
    };

    const createShopifyFile = async (resourceUrl) => {
      const query = `
        mutation fileCreate($files: [FileCreateInput!]!) {
          fileCreate(files: $files) { files { id } userErrors { message } }
        }
      `;
      const data = await shopifyGraphQL(query, { files: [{ originalSource: resourceUrl }] });
      if (data.fileCreate.userErrors.length) throw new Error(data.fileCreate.userErrors[0].message);
      return data.fileCreate.files[0].id;
    };

    // =======================
    // 3. UPLOAD BRAND FILES
    // =======================
    let lookbookFileId = null;
    if (lookbookFile && lookbookFile.size > 0) {
      const target = await stagedUpload(lookbookFile);
      await uploadToS3(target, lookbookFile);
      lookbookFileId = await createShopifyFile(target.resourceUrl);
    }

    let linesheetFileId = null;
    if (linesheetPdf && linesheetPdf.size > 0) {
      const target = await stagedUpload(linesheetPdf);
      await uploadToS3(target, linesheetPdf);
      linesheetFileId = await createShopifyFile(target.resourceUrl);
    }

    // =======================
    // 4. CREATE/UPDATE BRAND METAOBJECT
    // =======================
    let metaobjectResult = null;
    if (metaobjectId && metaobjectId.trim() !== "") {
      // UPDATE
      const fields = [
        { key: "brand_name", value: brandName },
        { key: "bio", value: bio || "" },
        { key: "category", value: category || "" },
        { key: "phone", value: phone || "" },
        { key: "contact_email", value: email || "" }
      ];
      if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
      if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

      const updateMutation = `
        mutation UpdateMetaobject($id: ID!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectUpdate(id: $id, metaobject: { fields: $fields }) {
            metaobject { id handle fields { key value } }
            userErrors { field message }
          }
        }
      `;
      const fullId = metaobjectId.startsWith("gid://") ? metaobjectId : `gid://shopify/Metaobject/${metaobjectId}`;
      const updateData = await shopifyGraphQL(updateMutation, { id: fullId, fields });
      if (updateData.metaobjectUpdate.userErrors.length) throw new Error(updateData.metaobjectUpdate.userErrors[0].message);
      metaobjectResult = { action: "update", metaobject: updateData.metaobjectUpdate.metaobject };
    } else {
      // CREATE
      const handle = `${brandName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
      const fields = [
        { key: "brand_name", value: brandName },
        { key: "bio", value: bio || "" },
        { key: "category", value: category || "" },
        { key: "phone", value: phone || "" },
        { key: "contact_email", value: email || "" }
      ];
      if (lookbookFileId) fields.push({ key: "lookbook_file", value: lookbookFileId });
      if (linesheetFileId) fields.push({ key: "linesheet_pdf", value: linesheetFileId });

      const createMutation = `
        mutation CreateMetaobject($handle: String!, $type: String!, $fields: [MetaobjectFieldInput!]!) {
          metaobjectCreate(metaobject: { handle: $handle, type: $type, fields: $fields }) {
            metaobject { id }
            userErrors { message }
          }
        }
      `;
      const createData = await shopifyGraphQL(createMutation, { handle, type: "brand_configurator", fields });
      if (createData.metaobjectCreate.userErrors.length) throw new Error(createData.metaobjectCreate.userErrors[0].message);
      metaobjectResult = { action: "create", metaobjectId: createData.metaobjectCreate.metaobject.id };
    }

    // =======================
    // 5. CREATE PRODUCT (IF title + price PROVIDED)
    // =======================
    let productResult = null;
    if (title && price && brandId) {
      const createProductMutation = `
        mutation productCreate($input: ProductInput!) {
          productCreate(input: $input) {
            product { id title vendor tags status }
            userErrors { field message }
          }
        }
      `;
      const productData = await shopifyGraphQL(createProductMutation, {
        input: { title, vendor: brandName || "Unknown", tags: email ? [email] : [], status: "DRAFT" }
      });
      if (productData.productCreate.userErrors.length) throw new Error(productData.productCreate.userErrors[0].message);

      const productId = productData.productCreate.product.id;

      // CREATE VARIANT
      if (price) {
        const createVariantMutation = `
          mutation productVariantsBulkCreate($productId: ID!, $variants: [ProductVariantsBulkInput!]!) {
            productVariantsBulkCreate(productId: $productId, variants: $variants) {
              productVariants { id price }
              userErrors { field message }
            }
          }
        `;
        await shopifyGraphQL(createVariantMutation, { productId, variants: [{ price: price.toString() }] });
      }

      // UPLOAD IMAGE
      if (imageFile && imageFile.size > 0) {
        const target = await stagedUpload(imageFile, "PRODUCT_IMAGE");
        await uploadToS3(target, imageFile);
        const attachImageMutation = `
          mutation productCreateMedia($productId: ID!, $media: [CreateMediaInput!]!) {
            productCreateMedia(productId: $productId, media: $media) {
              media { id alt }
              mediaUserErrors { field message }
            }
          }
        `;
        await shopifyGraphQL(attachImageMutation, { productId, media: [{ originalSource: target.resourceUrl, mediaContentType: "IMAGE" }] });
      }

      // ADD BRAND METAFIELD
      const metafieldMutation = `
        mutation metafieldsSet($metafields: [MetafieldsSetInput!]!) {
          metafieldsSet(metafields: $metafields) {
            metafields { id key value }
            userErrors { field message }
          }
        }
      `;
      await shopifyGraphQL(metafieldMutation, {
        metafields: [{ ownerId: productId, namespace: "custom", key: "brand_reference", value: brandId, type: "single_line_text_field" }]
      });

      productResult = { productId };
    }

    return { success: true, metaobject: metaobjectResult, product: productResult };

  } catch (error) {
    console.error('*** ACTION ERROR ***', error);
    return { success: false, error: error.message || "Action failed" };
  }
}
