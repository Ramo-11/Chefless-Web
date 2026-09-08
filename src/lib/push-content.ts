import { NotificationType } from "../models/Notification";

/**
 * Server-side localized push-notification copy. The recipient's saved account
 * `language` selects the language; English is the fallback. Mirrors the in-app
 * notification text (`notificationMessage` on the Flutter side) but is built
 * here because a push must be composed before it leaves the server.
 *
 * The English strings reproduce the previous hardcoded copy exactly, so English
 * users see no change. Returns `null` for any type without a template, so the
 * caller can fall back to the `pushTitle` / `pushBody` it passed in.
 */

export type PushLang = "en" | "ar" | "tr" | "es";

export interface PushContentInput {
  type: NotificationType;
  actorName?: string;
  recipeTitle?: string;
  kitchenName?: string;
  /** recipe_shared: the share message; passport_stamp: cuisine or `badge:<id>`; cooked_post_removed: reason. */
  shareMessage?: string;
  /** schedule import suggestions. */
  count?: number;
  /** passport stamp region (for the ` · Region` suffix). */
  regionName?: string;
  /** cooked_post_removed: the name of the owner who removed the photo. */
  ownerName?: string;
  commentPreview?: string;
}

export interface PushContent {
  title: string;
  body: string;
}

function pick<T>(lang: PushLang, en: T, ar: T, tr: T, es: T): T {
  return lang === "ar" ? ar : lang === "tr" ? tr : lang === "es" ? es : en;
}

export function buildPushContent(
  input: PushContentInput,
  lang: PushLang
): PushContent | null {
  const actor =
    input.actorName ?? pick(lang, "Someone", "شخص ما", "Biri", "Alguien");
  const recipe =
    input.recipeTitle ??
    pick(lang, "a recipe", "وصفة", "bir tarif", "una receta");
  const kitchen =
    input.kitchenName ??
    pick(lang, "the kitchen", "المطبخ", "mutfak", "la cocina");

  const previewSuffix = input.commentPreview
    ? `: ${input.commentPreview}`
    : "";

  switch (input.type) {
    case "recipe_commented":
      return {
        title: pick(
          lang,
          "New comment",
          "تعليق جديد",
          "Yeni yorum",
          "Nuevo comentario"
        ),
        body: pick(
          lang,
          `${actor} commented on your recipe "${recipe}"${previewSuffix}`,
          `علّق ${actor} على وصفتك "${recipe}"${previewSuffix}`,
          `${actor}, "${recipe}" tarifinize yorum yaptı${previewSuffix}`,
          `${actor} comentó en tu receta "${recipe}"${previewSuffix}`
        ),
      };
    case "cooked_post_commented":
      return {
        title: pick(
          lang,
          "New comment",
          "تعليق جديد",
          "Yeni yorum",
          "Nuevo comentario"
        ),
        body: pick(
          lang,
          `${actor} commented on your photo of "${recipe}"${previewSuffix}`,
          `علّق ${actor} على صورتك لوصفة "${recipe}"${previewSuffix}`,
          `${actor}, "${recipe}" fotoğrafınıza yorum yaptı${previewSuffix}`,
          `${actor} comentó en tu foto de "${recipe}"${previewSuffix}`
        ),
      };
    case "comment_reply":
      return {
        title: pick(
          lang,
          "New reply",
          "رد جديد",
          "Yeni yanıt",
          "Nueva respuesta"
        ),
        body: pick(
          lang,
          `${actor} replied to your comment${previewSuffix}`,
          `رد ${actor} على تعليقك${previewSuffix}`,
          `${actor} yorumunuzu yanıtladı${previewSuffix}`,
          `${actor} respondió a tu comentario${previewSuffix}`
        ),
      };
    case "new_follower":
      return {
        title: pick(
          lang,
          "New Follower",
          "متابِع جديد",
          "Yeni Takipçi",
          "Nuevo seguidor"
        ),
        body: pick(
          lang,
          `${actor} started following you.`,
          `بدأ ${actor} بمتابعتك.`,
          `${actor} seni takip etmeye başladı.`,
          `${actor} empezó a seguirte.`
        ),
      };
    case "follow_request":
      return {
        title: pick(
          lang,
          "Follow Request",
          "طلب متابعة",
          "Takip İsteği",
          "Solicitud de seguimiento"
        ),
        body: pick(
          lang,
          `${actor} wants to follow you.`,
          `يريد ${actor} متابعتك.`,
          `${actor} seni takip etmek istiyor.`,
          `${actor} quiere seguirte.`
        ),
      };
    case "follow_accepted":
      return {
        title: pick(
          lang,
          "Follow Request Accepted",
          "تم قبول طلب المتابعة",
          "Takip İsteği Kabul Edildi",
          "Solicitud de seguimiento aceptada"
        ),
        body: pick(
          lang,
          `${actor} accepted your follow request.`,
          `قبِل ${actor} طلب متابعتك.`,
          `${actor} takip isteğini kabul etti.`,
          `${actor} aceptó tu solicitud de seguimiento.`
        ),
      };
    case "recipe_liked":
      return {
        title: pick(
          lang,
          "Recipe Liked",
          "إعجاب بوصفة",
          "Tarif Beğenildi",
          "Me gusta en tu receta"
        ),
        body: pick(
          lang,
          `${actor} liked your recipe "${recipe}".`,
          `أعجب ${actor} بوصفتك "${recipe}".`,
          `${actor}, "${recipe}" tarifini beğendi.`,
          `A ${actor} le gustó tu receta "${recipe}".`
        ),
      };
    case "recipe_saved":
      return {
        title: pick(
          lang,
          "Recipe Saved",
          "حفظ وصفة",
          "Tarif Kaydedildi",
          "Receta guardada"
        ),
        body: pick(
          lang,
          `${actor} saved your recipe "${recipe}".`,
          `حفظ ${actor} وصفتك "${recipe}".`,
          `${actor}, "${recipe}" tarifini kaydetti.`,
          `${actor} guardó tu receta "${recipe}".`
        ),
      };
    case "recipe_forked":
      return {
        title: pick(
          lang,
          "Recipe remixed",
          "إعادة ابتكار وصفة",
          "Tarif Remixlendi",
          "Nuevo Remix"
        ),
        body: pick(
          lang,
          `${actor} remixed your recipe "${recipe}".`,
          `أعاد ${actor} ابتكار وصفتك "${recipe}".`,
          `${actor}, "${recipe}" tarifini remixledi.`,
          `${actor} hizo un Remix de tu receta "${recipe}".`
        ),
      };
    case "recipe_shared": {
      const msg = input.shareMessage?.trim();
      const preview =
        msg && msg.length > 120 ? `${msg.slice(0, 117)}...` : msg;
      return {
        title: pick(
          lang,
          "Recipe Shared",
          "مشاركة وصفة",
          "Tarif Paylaşıldı",
          "Receta compartida"
        ),
        body: preview
          ? pick(
              lang,
              `${actor} shared "${recipe}" with you: "${preview}"`,
              `شارك ${actor} معك "${recipe}": "${preview}"`,
              `${actor}, "${recipe}" tarifini seninle paylaştı: "${preview}"`,
              `${actor} compartió "${recipe}" contigo: "${preview}"`
            )
          : pick(
              lang,
              `${actor} shared a recipe with you: "${recipe}".`,
              `شارك ${actor} وصفة معك: "${recipe}".`,
              `${actor} seninle bir tarif paylaştı: "${recipe}".`,
              `${actor} compartió una receta contigo: "${recipe}".`
            ),
      };
    }
    case "schedule_suggestion": {
      const count = input.count;
      if (count && count > 0) {
        const mealWordEn = count === 1 ? "meal" : "meals";
        const mealWordEs = count === 1 ? "comida" : "comidas";
        return {
          title: pick(
            lang,
            "New Meal Suggestions",
            "اقتراحات وجبات جديدة",
            "Yeni Öğün Önerileri",
            "Nuevas sugerencias de comidas"
          ),
          body: pick(
            lang,
            `${actor} imported ${count} ${mealWordEn} as suggestions in ${kitchen}.`,
            `استورد ${actor} ${count} وجبة كاقتراحات في ${kitchen}.`,
            `${actor}, ${kitchen} mutfağına öneri olarak ${count} öğün aktardı.`,
            `${actor} importó ${count} ${mealWordEs} como sugerencias en ${kitchen}.`
          ),
        };
      }
      return {
        title: pick(
          lang,
          "New Meal Suggestion",
          "اقتراح وجبة جديد",
          "Yeni Öğün Önerisi",
          "Nueva sugerencia de comida"
        ),
        body: pick(
          lang,
          `${actor} suggested a meal in ${kitchen}.`,
          `اقترح ${actor} وجبة في ${kitchen}.`,
          `${actor}, ${kitchen} mutfağında bir öğün önerdi.`,
          `${actor} sugirió una comida en ${kitchen}.`
        ),
      };
    }
    case "suggestion_approved":
      return {
        title: pick(
          lang,
          "Suggestion Approved",
          "تمت الموافقة على الاقتراح",
          "Öneri Onaylandı",
          "Sugerencia aprobada"
        ),
        body: pick(
          lang,
          `Your meal suggestion in ${kitchen} was approved.`,
          `تمت الموافقة على اقتراح وجبتك في ${kitchen}.`,
          `${kitchen} mutfağındaki öğün önerin onaylandı.`,
          `Tu sugerencia de comida en ${kitchen} fue aprobada.`
        ),
      };
    case "suggestion_denied":
      return {
        title: pick(
          lang,
          "Suggestion Denied",
          "تم رفض الاقتراح",
          "Öneri Reddedildi",
          "Sugerencia rechazada"
        ),
        body: pick(
          lang,
          `Your meal suggestion in ${kitchen} was denied.`,
          `تم رفض اقتراح وجبتك في ${kitchen}.`,
          `${kitchen} mutfağındaki öğün önerin reddedildi.`,
          `Tu sugerencia de comida en ${kitchen} fue rechazada.`
        ),
      };
    case "kitchen_food_ready":
      return {
        title: pick(
          lang,
          "Food is ready",
          "الطعام جاهز",
          "Yemek hazır",
          "La comida está lista"
        ),
        body: pick(
          lang,
          `${actor} says food is ready in ${kitchen}. Come and get it!`,
          `${actor} يقول إن الطعام جاهز في ${kitchen}. تعال وتناوله!`,
          `${actor}, ${kitchen} mutfağında yemeğin hazır olduğunu söylüyor. Gelip alın!`,
          `${actor} dice que la comida está lista en ${kitchen}. ¡Ven a por ella!`
        ),
      };
    case "kitchen_joined":
      return {
        title: pick(
          lang,
          "New Kitchen Member",
          "عضو جديد في المطبخ",
          "Yeni Mutfak Üyesi",
          "Nuevo miembro de la cocina"
        ),
        body: pick(
          lang,
          `${actor} joined ${kitchen}.`,
          `انضم ${actor} إلى ${kitchen}.`,
          `${actor}, ${kitchen} mutfağına katıldı.`,
          `${actor} se unió a ${kitchen}.`
        ),
      };
    case "kitchen_invite":
      return {
        title: pick(lang, "Kitchen", "المطبخ", "Mutfak", "Cocina"),
        body: pick(
          lang,
          `You're now a member of ${kitchen}.`,
          `أنت الآن عضو في ${kitchen}.`,
          `Artık ${kitchen} mutfağının bir üyesisin.`,
          `Ahora eres miembro de ${kitchen}.`
        ),
      };
    case "kitchen_removed":
      return {
        title: pick(
          lang,
          "Removed from Kitchen",
          "تمت إزالتك من المطبخ",
          "Mutfaktan Çıkarıldın",
          "Eliminado de la cocina"
        ),
        body: pick(
          lang,
          `You were removed from ${kitchen}.`,
          `تمت إزالتك من ${kitchen}.`,
          `${kitchen} mutfağından çıkarıldın.`,
          `Has sido eliminado de ${kitchen}.`
        ),
      };
    case "kitchen_invite_received":
      return {
        title: pick(
          lang,
          "Kitchen invite",
          "دعوة إلى مطبخ",
          "Mutfak Daveti",
          "Invitación a la cocina"
        ),
        body: pick(
          lang,
          `${actor} invited you to join ${kitchen}.`,
          `دعاك ${actor} للانضمام إلى ${kitchen}.`,
          `${actor} seni ${kitchen} mutfağına katılmaya davet etti.`,
          `${actor} te invitó a unirte a ${kitchen}.`
        ),
      };
    case "kitchen_invite_accepted":
      return {
        title: pick(
          lang,
          "Invite accepted",
          "تم قبول الدعوة",
          "Davet Kabul Edildi",
          "Invitación aceptada"
        ),
        body: pick(
          lang,
          `${actor} joined ${kitchen}.`,
          `انضم ${actor} إلى ${kitchen}.`,
          `${actor}, ${kitchen} mutfağına katıldı.`,
          `${actor} se unió a ${kitchen}.`
        ),
      };
    case "kitchen_invite_declined":
      return {
        title: pick(
          lang,
          "Invite declined",
          "تم رفض الدعوة",
          "Davet Reddedildi",
          "Invitación rechazada"
        ),
        body: pick(
          lang,
          `${actor} declined your kitchen invite.`,
          `رفض ${actor} دعوتك إلى المطبخ.`,
          `${actor} mutfak davetini reddetti.`,
          `${actor} rechazó tu invitación a la cocina.`
        ),
      };
    case "kitchen_lead_transferred":
      return {
        title: pick(
          lang,
          "Kitchen lead",
          "قائد المطبخ",
          "Mutfak Lideri",
          "Líder de la cocina"
        ),
        body: input.actorName
          ? pick(
              lang,
              `${actor} made you the lead of ${kitchen}.`,
              `جعلك ${actor} قائد ${kitchen}.`,
              `${actor} seni ${kitchen} mutfağının lideri yaptı.`,
              `${actor} te nombró líder de ${kitchen}.`
            )
          : pick(
              lang,
              `You're now the lead of ${kitchen}.`,
              `أنت الآن قائد ${kitchen}.`,
              `Artık ${kitchen} mutfağının lidersin.`,
              `Ahora eres el líder de ${kitchen}.`
            ),
      };
    case "recipe_cooked":
      return {
        title: pick(
          lang,
          "Someone cooked your recipe",
          "طبخ أحدهم وصفتك",
          "Biri tarifini pişirdi",
          "Alguien cocinó tu receta"
        ),
        body: pick(
          lang,
          `${actor} cooked "${recipe}".`,
          `طبخ ${actor} "${recipe}".`,
          `${actor}, "${recipe}" tarifini pişirdi.`,
          `${actor} cocinó "${recipe}".`
        ),
      };
    case "passport_stamp": {
      const raw = input.shareMessage ?? "";
      if (raw.startsWith("badge:")) {
        return {
          title: pick(
            lang,
            "Badge unlocked",
            "تم فتح شارة",
            "Rozet Açıldı",
            "Insignia desbloqueada"
          ),
          body: pick(
            lang,
            "You earned a new Chefless passport badge.",
            "حصلت على شارة جواز سفر جديدة في Chefless.",
            "Yeni bir Chefless pasaport rozeti kazandın.",
            "Ganaste una nueva insignia del pasaporte de Chefless."
          ),
        };
      }
      const cuisine = raw;
      const suffix = input.regionName ? ` · ${input.regionName}` : "";
      return {
        title: pick(
          lang,
          "New passport stamp",
          "ختم جواز سفر جديد",
          "Yeni Pasaport Damgası",
          "Nuevo sello de pasaporte"
        ),
        body: pick(
          lang,
          `Unlocked ${cuisine}${suffix}. Tap to see your passport.`,
          `فتحت ${cuisine}${suffix}. اضغط لرؤية جواز سفرك.`,
          `${cuisine}${suffix} açıldı. Pasaportunu görmek için dokun.`,
          `Desbloqueaste ${cuisine}${suffix}. Toca para ver tu pasaporte.`
        ),
      };
    }
    case "cooked_post_removed": {
      const owner =
        input.ownerName ??
        pick(lang, "An owner", "أحد المالكين", "Bir sahip", "Un propietario");
      const reason = input.shareMessage ?? "";
      return {
        title: pick(
          lang,
          "Your cooked-it photo was removed",
          'تمت إزالة صورة "طبختها"',
          "Pişirdim fotoğrafın kaldırıldı",
          'Se eliminó tu foto de "Lo cociné"'
        ),
        body: pick(
          lang,
          `${owner} removed your "I Cooked It" photo for "${recipe}". Reason: ${reason}`,
          `أزال ${owner} صورة "لقد طبختها" لوصفة "${recipe}". السبب: ${reason}`,
          `${owner}, "${recipe}" için "Pişirdim" fotoğrafını kaldırdı. Sebep: ${reason}`,
          `${owner} eliminó tu foto de "Lo cociné" de "${recipe}". Motivo: ${reason}`
        ),
      };
    }
    default:
      return null;
  }
}
